// ============================================================================
// Local log + one-click diagnostic export.
//
// The app used to be silent: every failure on the way up (a tray icon that would
// not build, a config file that would not parse, an update that would not verify)
// either printed to a console nobody sees in a packaged build or was swallowed by
// `let _ =`. When something goes wrong on a user's machine there is nothing to
// look at, and nothing to send along with a bug report.
//
// This module is that missing piece, kept deliberately small and dependency-free
// (the project ships no logging crate):
//   * one append-only file, `logs/booloo.log` next to `config.json`, rotated to a
//     single `.1` backup once it passes 512 KB;
//   * `info` / `warn` / `error` — no configuration, no targets, no formatting
//     machinery. A line is a timestamp, a level and the message;
//   * `export_diagnostics` copies the log (and the rotated backup) plus an
//     `environment.json` into a folder the user picks, ready to attach to a report;
//   * `reveal_log` shows the file in the OS file manager.
//
// Nothing here can fail loudly: logging must never be the reason the app dies, so
// every write path returns quietly on error. Before `init` runs the sink is empty
// and every call is a no-op, which is also what keeps `cargo test` clean.
// ============================================================================

use crate::config::ConfigState;
use crate::i18n::translate;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// One log may grow to this before it is rolled over. Small on purpose: the file
/// travels in a bug report, and the interesting window is the last few runs.
const MAX_BYTES: u64 = 512 * 1024;
const FILE_NAME: &str = "booloo.log";
const ROTATED_NAME: &str = "booloo.log.1";

/// Where the current log is written. `None` until `init`, so every call from a
/// test (which never builds an `AppHandle`) is a no-op.
fn sink() -> &'static Mutex<Option<PathBuf>> {
    static SINK: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

/// The log file's location, once `init` has run.
pub fn log_path() -> Option<PathBuf> {
    sink().lock().ok().and_then(|guard| guard.clone())
}

/// Point the sink at `logs/booloo.log` and record the run's first line.
pub fn init(app: &AppHandle) {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("logs");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(FILE_NAME);
    if let Ok(mut guard) = sink().lock() {
        *guard = Some(path);
    }
    info(format!(
        "Booloo {} starting on {}/{}",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
}

pub fn info(message: impl AsRef<str>) {
    write("INFO", message.as_ref());
}

pub fn warn(message: impl AsRef<str>) {
    write("WARN", message.as_ref());
}

pub fn error(message: impl AsRef<str>) {
    write("ERROR", message.as_ref());
}

fn write(level: &str, message: &str) {
    // A poisoned lock means another thread panicked mid-write; the log is not
    // worth propagating that here.
    let Ok(guard) = sink().lock() else {
        return;
    };
    let Some(path) = guard.as_deref() else {
        return;
    };
    append(path, level, message);
}

/// Append one entry, rolling the file over first when it has grown too large.
///
/// A multi-line message is split so every line carries its own timestamp — a
/// stack trace or an embedded error body stays readable once it is in the file.
fn append(path: &Path, level: &str, message: &str) {
    rotate(path);
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    for line in message.split('\n') {
        let _ = writeln!(file, "{} [{}] {}", timestamp(), level, line);
    }
}

/// Move the log aside once it passes the cap, keeping exactly one backup.
fn rotate(path: &Path) {
    let size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if size < MAX_BYTES {
        return;
    }
    let rotated = path.with_file_name(ROTATED_NAME);
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, &rotated);
}

/// Local wall-clock timestamp for a log line.
#[cfg(target_os = "windows")]
pub(crate) fn timestamp() -> String {
    #[repr(C)]
    struct LocalTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }
    extern "system" {
        fn GetLocalTime(out: *mut LocalTime);
    }
    let mut now = LocalTime {
        year: 0,
        month: 0,
        day_of_week: 0,
        day: 0,
        hour: 0,
        minute: 0,
        second: 0,
        milliseconds: 0,
    };
    // SAFETY: `now` is a correctly-sized, aligned struct that outlives the call.
    unsafe { GetLocalTime(&mut now) };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        now.year, now.month, now.day, now.hour, now.minute, now.second, now.milliseconds
    )
}

/// UTC timestamp for a log line (the other platforms have no cheap local-time
/// call, and a UTC clock is enough to line up a report).
#[cfg(not(target_os = "windows"))]
pub(crate) fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = elapsed.as_secs() as i64;
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let in_day = seconds.rem_euclid(86_400);
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        in_day / 3600,
        (in_day % 3600) / 60,
        in_day % 60,
        elapsed.subsec_millis()
    )
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's `civil_from_days`.
#[cfg(not(target_os = "windows"))]
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Copy the logs and an environment snapshot into a folder the user picks.
///
/// The result shape mirrors the pack commands: `{ ok, cancelled }` on a closed
/// dialog, `{ ok, path }` on success, `{ ok: false, error }` on a real failure.
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle) -> Value {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| {
            let _ = sender.send(path);
        });
    let Some(picked) = receiver.recv().ok().flatten() else {
        return json!({ "ok": false, "cancelled": true });
    };
    let preference = current_locale(&app);
    let locale = crate::i18n::resolve(&preference);
    let Ok(destination) = picked.into_path() else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.readFailed") });
    };
    let target = destination.join("booloo-diagnostics");
    if fs::create_dir_all(&target).is_err() {
        return json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") });
    }
    let Some(log) = log_path() else {
        return json!({ "ok": false, "error": translate(&locale, "dialog.readFailed") });
    };
    // Best effort for the log itself: a fresh install that never wrote one still
    // gets the environment snapshot, which is the more useful half anyway.
    if log.is_file() {
        let _ = fs::copy(&log, target.join(FILE_NAME));
    }
    let rotated = log.with_file_name(ROTATED_NAME);
    if rotated.is_file() {
        let _ = fs::copy(&rotated, target.join(ROTATED_NAME));
    }
    let environment = json!({
        "app": "Booloo",
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "locale": locale,
        "logPath": log.to_string_lossy(),
        "exportedAt": timestamp(),
    });
    let written = serde_json::to_string_pretty(&environment)
        .ok()
        .map(|raw| fs::write(target.join("environment.json"), raw));
    match written {
        Some(Ok(())) => json!({ "ok": true, "path": target.to_string_lossy() }),
        _ => json!({ "ok": false, "error": translate(&locale, "dialog.copyFailed") }),
    }
}

/// Show the log file in the OS file manager, creating an empty one if needed so
/// the button always opens something.
#[tauri::command]
pub fn reveal_log() -> Result<(), String> {
    let Some(path) = log_path() else {
        return Err("logging is not initialized".into());
    };
    if !path.exists() {
        let _ = fs::write(&path, b"");
    }
    reveal(&path)
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal(path: &Path) -> Result<(), String> {
    // The common file managers on Linux have no portable "select this file", so
    // the containing folder is opened instead.
    let folder = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open")
        .arg(folder)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<ConfigState>()
        .and_then(|state| state.get("locale").as_str().map(str::to_string))
        .unwrap_or_else(|| "zh".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("booloo-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A log over the cap is renamed to the `.1` backup, never truncated in place:
    /// the old content is what a report is usually about.
    #[test]
    fn rotate_moves_a_full_log_aside() {
        let dir = scratch("full");
        let path = dir.join(FILE_NAME);
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();

        rotate(&path);

        assert!(!path.exists(), "the full log is renamed, not left behind");
        let rotated = path.with_file_name(ROTATED_NAME);
        assert_eq!(fs::metadata(&rotated).unwrap().len(), MAX_BYTES + 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotate_leaves_a_small_log_alone() {
        let dir = scratch("small");
        let path = dir.join(FILE_NAME);
        fs::write(&path, b"one line\n").unwrap();

        rotate(&path);

        assert!(path.exists());
        assert!(!path.with_file_name(ROTATED_NAME).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Every line has to be self-describing: a level and a timestamp, including
    /// the ones a multi-line message was split into.
    #[test]
    fn lines_carry_a_timestamp_and_level() {
        let dir = scratch("lines");
        let path = dir.join(FILE_NAME);

        append(&path, "WARN", "first\nsecond");

        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2, "a multi-line message is one line per entry");
        for line in lines {
            assert!(line.contains("[WARN]"), "each line is tagged with its level: {line}");
            assert!(line.len() > "[WARN] ".len(), "each line carries a timestamp too: {line}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// The date arithmetic behind the non-Windows timestamp.
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn epoch_day_zero_is_the_first_of_january_1970() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_000), (2022, 1, 8));
    }
}
