// ============================================================================
// Software updates — the Tauri counterpart of the Electron updater panel.
//
// The renderer already owns the update UI (settings panel + header badge); this
// module backs it with tauri-plugin-updater. The flow is exposed as plain commands
// so the existing `window.api` shim (src/renderer/lite-api.ts) keeps working
// without the plugin's JS bindings or a bundler.
//
// Checking is deliberately *not* the plugin's `check()`: that asks GitHub for
// `latest.json`, which is fine for the installer but is one more network-shaped
// failure to explain to the user. Instead the version comes from the
// `releases/latest` redirect (`/releases/tag/vX.Y.Z`), a single bare GET that
// costs no REST quota and needs no JSON. Only when that fails do we read the
// manifest, and only when both fail do we reach for the last successful result.
//
// Statuses mirror the `UpdateStatus` union in src/shared/types.ts.
// ============================================================================

use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Updater, UpdaterExt};

/// Manual fallback URL, shown while the updater is not configured or a check fails.
const RELEASES_URL: &str = "https://github.com/Aceeee2077/BoolooPet/releases/latest";
/// The manifest the installer itself reads. Used for release notes and as the
/// second probe when the redirect is unreachable.
const MANIFEST_URL: &str =
    "https://github.com/Aceeee2077/BoolooPet/releases/latest/download/latest.json";
/// A successful check is reused for six hours unless the user asks again.
const CHECK_INTERVAL_MS: i64 = 6 * 60 * 60 * 1000;
/// Probes are small requests: a slow answer is the same as no answer.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// Downloads are large files, so the plugin must not inherit the probe timeout.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const CACHE_FILE: &str = "update-check.json";

/// Holds the verified installer bytes between `update_download` and `update_install`.
#[derive(Default)]
pub struct DownloadedState(pub Mutex<Option<Vec<u8>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressOut {
    pub percent: f64,
    pub transferred: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStateOut {
    pub status: String,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<UpdateProgressOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_url: Option<String>,
    /// Epoch ms of the last successful check, so Settings can show its age even
    /// while the network is down.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked: Option<i64>,
    /// This snapshot came from the cache because a fresh check failed.
    pub stale: bool,
    pub auto_check: bool,
    pub auto_download: bool,
    pub channel: String,
}

/// The last successful check, persisted next to config.json.
///
/// A failed probe never overwrites it: that is the whole point of keeping it.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCache {
    pub checked_at: i64,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub source: String,
}

/// Survives a read-only config dir (portable builds) for the rest of the session.
static MEMORY_CACHE: Mutex<Option<CheckCache>> = Mutex::new(None);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/** A trimmed config string, or None when the key is absent or blank. */
fn config_string(config: &ConfigState, key: &str) -> Option<String> {
    config
        .get(key)
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(CACHE_FILE))
}

fn read_cache(app: &AppHandle) -> Option<CheckCache> {
    if let Some(hit) = MEMORY_CACHE.lock().unwrap().clone() {
        return Some(hit);
    }
    let raw = std::fs::read_to_string(cache_path(app)?).ok()?;
    let cache = serde_json::from_str::<CheckCache>(&raw).ok()?;
    *MEMORY_CACHE.lock().unwrap() = Some(cache.clone());
    Some(cache)
}

fn write_cache(app: &AppHandle, cache: CheckCache) {
    *MEMORY_CACHE.lock().unwrap() = Some(cache.clone());
    // Portable builds may live in a read-only folder. The in-memory copy above
    // already keeps this session consistent, so a failed write is not an error
    // worth surfacing (or logging over and over).
    let Some(path) = cache_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&cache) {
        let _ = std::fs::write(&path, bytes);
    }
}

/// Extra PEM roots the user pointed at (`updateCaCert`): one file, one or more
/// certificates, e.g. a self-signed mirror or a corporate TLS proxy.
fn root_certificates(config: &ConfigState) -> Vec<reqwest::Certificate> {
    let Some(path) = config_string(config, "updateCaCert") else {
        return Vec::new();
    };
    match std::fs::read(&path) {
        Ok(bytes) => match reqwest::Certificate::from_pem_bundle(&bytes) {
            Ok(certs) => certs,
            Err(err) => {
                crate::logfile::warn(format!("updateCaCert could not be parsed: {err}"));
                Vec::new()
            }
        },
        Err(err) => {
            crate::logfile::warn(format!("updateCaCert could not be read: {err}"));
            Vec::new()
        }
    }
}

/// One probe client. `follow_redirects = false` is what turns
/// `releases/latest` into a readable `Location` header.
fn http_client(config: &ConfigState, follow_redirects: bool) -> Result<reqwest::Client, String> {
    // `rustls-no-provider` leaves the provider to us. The plugin installs the
    // same ring provider on first use, so a second install failing is expected.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .user_agent(concat!("Booloo/", env!("CARGO_PKG_VERSION")));

    if !follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }

    // A custom proxy wins over the OS setting; with the `system-proxy` feature
    // reqwest already picks up the system one when this is unset.
    if let Some(url) = config_string(config, "updateProxy") {
        match reqwest::Proxy::all(url.as_str()) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(err) => crate::logfile::warn(format!("updateProxy is not a URL: {err}")),
        }
    }

    // Trust one extra PEM root (self-signed mirror, TLS interception) instead of
    // disabling verification for every host.
    for cert in root_certificates(config) {
        builder = builder.add_root_certificate(cert);
    }

    builder.build().map_err(|err| err.to_string())
}

/// `/releases/tag/v0.6.24` → `0.6.24`. Anything that is not a semver tag (the
/// `/releases` landing page, a `latest` slug) yields None.
fn version_from_tag(tag: &str) -> Option<String> {
    let tag = tag.split(|c| c == '?' || c == '#').next().unwrap_or(tag);
    let tag = tag.trim_end_matches('/');
    let last = tag.rsplit('/').next()?;
    let version = last.strip_prefix('v').unwrap_or(last);
    semver::Version::parse(version)
        .ok()
        .map(|parsed| parsed.to_string())
}

/// Reads the version out of a 302 without downloading the release page.
async fn probe_redirect(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client.get(url).send().await.ok()?;
    response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .and_then(version_from_tag)
        // A mirror may answer 200 with the release page already resolved.
        .or_else(|| version_from_tag(response.url().as_str()))
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
}

/// Reads a `latest.json` (GitHub's or a mirror's) for the version and notes.
async fn probe_manifest(
    client: &reqwest::Client,
    url: &str,
) -> Option<(String, Option<String>)> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let manifest = response.json::<Manifest>().await.ok()?;
    let version = version_from_tag(&manifest.version)?;
    Some((version, manifest.notes))
}

/// Endpoints the user added in config.json, comma / whitespace separated.
fn mirror_endpoints(config: &ConfigState) -> Vec<String> {
    config_string(config, "updateMirror")
        .map(|raw| {
            raw.split(|c: char| c == ',' || c.is_whitespace())
                .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

struct Found {
    version: String,
    notes: Option<String>,
    source: String,
}

/// Ordered discovery: GitHub redirect → GitHub manifest → mirrors.
async fn discover(config: &ConfigState) -> Option<Found> {
    let probe = http_client(config, false).ok();
    let fetch = http_client(config, true).ok();

    // 1. One GET, no REST quota, no JSON to parse.
    if let Some(client) = probe.as_ref() {
        if let Some(version) = probe_redirect(client, RELEASES_URL).await {
            return Some(Found {
                version,
                notes: None,
                source: "github".to_string(),
            });
        }
    }

    // 2. The manifest also carries the notes the settings panel shows.
    if let Some(client) = fetch.as_ref() {
        if let Some((version, notes)) = probe_manifest(client, MANIFEST_URL).await {
            return Some(Found {
                version,
                notes,
                source: "manifest".to_string(),
            });
        }
    }

    // 3. Mirror endpoints: try a manifest first (richer), then a redirect probe.
    for endpoint in mirror_endpoints(config) {
        if let Some(client) = fetch.as_ref() {
            if let Some((version, notes)) = probe_manifest(client, &endpoint).await {
                return Some(Found {
                    version,
                    notes,
                    source: endpoint,
                });
            }
        }
        if let Some(client) = probe.as_ref() {
            if let Some(version) = probe_redirect(client, &endpoint).await {
                return Some(Found {
                    version,
                    notes: None,
                    source: endpoint,
                });
            }
        }
    }

    None
}

fn is_newer(candidate: &str, current: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(current),
    ) {
        (Ok(candidate), Ok(current)) => candidate > current,
        // A version we cannot parse is not worth interrupting the user for.
        _ => false,
    }
}

fn read_prefs(config: &ConfigState) -> (bool, bool, String) {
    (
        config.get("updateAutoCheck").as_bool().unwrap_or(true),
        config.get("updateAutoDownload").as_bool().unwrap_or(true),
        config
            .get("updateChannel")
            .as_str()
            .unwrap_or("stable")
            .to_string(),
    )
}

fn base_state(app: &AppHandle, config: &ConfigState, status: &str) -> UpdateStateOut {
    let (auto_check, auto_download, channel) = read_prefs(config);
    UpdateStateOut {
        status: status.to_string(),
        current_version: app.package_info().version.to_string(),
        version: None,
        progress: None,
        notes: None,
        error: None,
        manual_url: Some(RELEASES_URL.to_string()),
        last_checked: None,
        stale: false,
        auto_check,
        auto_download,
        channel,
    }
}

/// The snapshot a cached result maps to. `stale` marks "this is the last known
/// answer, the network did not answer just now".
fn cached_state(
    app: &AppHandle,
    config: &ConfigState,
    cache: &CheckCache,
    stale: bool,
) -> UpdateStateOut {
    let mut state = base_state(app, config, "idle");
    state.last_checked = Some(cache.checked_at);
    state.stale = stale;
    if let Some(version) = cache.version.clone() {
        state.status = if is_newer(&version, &state.current_version) {
            "available".to_string()
        } else {
            "up-to-date".to_string()
        };
        state.version = Some(version);
        state.notes = cache.notes.clone();
    }
    state
}

fn emit_state(app: &AppHandle, state: &UpdateStateOut) {
    let _ = app.emit("update-state", state.clone());
}

fn progress_state(
    current_version: &str,
    version: &str,
    channel: &str,
    auto_check: bool,
    auto_download: bool,
    transferred: u64,
    total: u64,
) -> UpdateStateOut {
    let percent = if total > 0 {
        (transferred as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    UpdateStateOut {
        status: "downloading".to_string(),
        current_version: current_version.to_string(),
        version: Some(version.to_string()),
        progress: Some(UpdateProgressOut {
            percent,
            transferred,
            total,
            bytes_per_second: 0,
        }),
        notes: None,
        error: None,
        manual_url: Some(RELEASES_URL.to_string()),
        // The renderer keeps the previous "last checked" line when this is absent.
        last_checked: None,
        stale: false,
        auto_check,
        auto_download,
        channel: channel.to_string(),
    }
}

/// The plugin updater, with the same proxy override and a download-sized timeout.
fn plugin_updater(app: &AppHandle, config: &ConfigState) -> Result<Updater, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let mut builder = app.updater_builder().timeout(DOWNLOAD_TIMEOUT);

    if let Some(proxy) = config_string(config, "updateProxy").and_then(|url| reqwest::Url::parse(&url).ok()) {
        builder = builder.proxy(proxy);
    }

    let certs = root_certificates(config);
    if !certs.is_empty() {
        builder = builder.configure_client(move |client| {
            certs
                .iter()
                .fold(client, |client, cert| client.add_root_certificate(cert.clone()))
        });
    }

    builder.build().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_get_state(app: AppHandle, config: State<'_, ConfigState>) -> UpdateStateOut {
    match read_cache(&app) {
        Some(cache) => cached_state(&app, &config, &cache, false),
        None => base_state(&app, &config, "idle"),
    }
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    config: State<'_, ConfigState>,
    force: Option<bool>,
) -> Result<UpdateStateOut, String> {
    let cached = read_cache(&app);

    // Throttle: the startup check, the tray and a reopened panel all land here,
    // and none of them is worth a request if the last one succeeded minutes ago.
    // The check button passes `force` to bypass this.
    if !force.unwrap_or(false) {
        if let Some(cache) = cached.as_ref() {
            if now_ms().saturating_sub(cache.checked_at) < CHECK_INTERVAL_MS {
                return Ok(cached_state(&app, &config, cache, false));
            }
        }
    }

    let mut state = base_state(&app, &config, "checking");
    state.last_checked = cached.as_ref().map(|cache| cache.checked_at);
    emit_state(&app, &state);

    match discover(&config).await {
        Some(found) => {
            crate::logfile::info(format!(
                "update check found {} via {}",
                found.version, found.source
            ));
            let cache = CheckCache {
                checked_at: now_ms(),
                version: Some(found.version),
                notes: found.notes,
                source: found.source,
            };
            write_cache(&app, cache.clone());
            let state = cached_state(&app, &config, &cache, false);
            emit_state(&app, &state);
            Ok(state)
        }
        None => {
            // A failed probe is not an error the user can act on: when we have a
            // previous answer show it (marked stale), otherwise stay silent.
            crate::logfile::warn("the update check failed; using the cached result");
            let state = match cached.as_ref() {
                Some(cache) => cached_state(&app, &config, cache, true),
                None => base_state(&app, &config, "idle"),
            };
            emit_state(&app, &state);
            Ok(state)
        }
    }
}

#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    config: State<'_, ConfigState>,
    downloaded: State<'_, DownloadedState>,
) -> Result<UpdateStateOut, String> {
    let mut state = base_state(&app, &config, "downloading");
    emit_state(&app, &state);

    let updater = match plugin_updater(&app, &config) {
        Ok(updater) => updater,
        Err(err) => {
            crate::logfile::error(format!("the updater is unavailable: {err}"));
            state.status = "error".to_string();
            state.error = Some(err);
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            state.status = "up-to-date".to_string();
            state.error = None;
            emit_state(&app, &state);
            return Ok(state);
        }
        Err(err) => {
            crate::logfile::error(format!("the update check failed: {err}"));
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let current_version = app.package_info().version.to_string();
    let version = update.version.clone();
    let (auto_check, auto_download, channel) = read_prefs(&config);

    let app_cb = app.clone();
    let cv = current_version.clone();
    let ver = version.clone();
    let ch = channel.clone();

    let mut transferred: u64 = 0;
    let mut total: u64 = 0;
    let bytes = update
        .download(
            move |chunk_len, content_len| {
                transferred += chunk_len as u64;
                if let Some(n) = content_len {
                    total = n;
                }
                let progress = progress_state(
                    &cv,
                    &ver,
                    &ch,
                    auto_check,
                    auto_download,
                    transferred,
                    total,
                );
                let _ = app_cb.emit("update-state", progress);
            },
            || {},
        )
        .await;

    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(err) => {
            crate::logfile::error(format!("the update download failed: {err}"));
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    crate::logfile::info(format!("update {version} downloaded"));
    *downloaded.0.lock().unwrap() = Some(bytes);

    state.status = "downloaded".to_string();
    state.version = Some(version);
    state.progress = None;
    state.error = None;
    emit_state(&app, &state);
    Ok(state)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    config: State<'_, ConfigState>,
    downloaded: State<'_, DownloadedState>,
) -> Result<(), String> {
    // The install is the step that can still fail after a download that looked
    // fine — signature verification lives in here — so it is the one place worth
    // wrapping: every failure mode ends up in the log with the same shape.
    match run_install(&app, &config, downloaded.inner()).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::logfile::error(format!("the update could not be installed: {error}"));
            Err(error)
        }
    }
}

async fn run_install(
    app: &AppHandle,
    config: &ConfigState,
    downloaded: &DownloadedState,
) -> Result<(), String> {
    let bytes = downloaded
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no downloaded update".to_string())?;
    let updater = plugin_updater(app, config)?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update.install(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_install_when_ready(
    app: AppHandle,
    config: State<'_, ConfigState>,
) -> Result<UpdateStateOut, String> {
    let mut state = base_state(&app, &config, "downloading");
    emit_state(&app, &state);

    let updater = match plugin_updater(&app, &config) {
        Ok(updater) => updater,
        Err(err) => {
            crate::logfile::error(format!("the updater is unavailable: {err}"));
            state.status = "error".to_string();
            state.error = Some(err);
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            state.status = "up-to-date".to_string();
            state.error = None;
            emit_state(&app, &state);
            return Ok(state);
        }
        Err(err) => {
            crate::logfile::error(format!("the update check failed: {err}"));
            state.status = "error".to_string();
            state.error = Some(err.to_string());
            emit_state(&app, &state);
            return Ok(state);
        }
    };

    let current_version = app.package_info().version.to_string();
    let version = update.version.clone();
    let (auto_check, auto_download, channel) = read_prefs(&config);

    let app_cb = app.clone();
    let cv = current_version.clone();
    let ver = version.clone();
    let ch = channel.clone();

    let mut transferred: u64 = 0;
    let mut total: u64 = 0;
    let result = update
        .download_and_install(
            move |chunk_len, content_len| {
                transferred += chunk_len as u64;
                if let Some(n) = content_len {
                    total = n;
                }
                let progress = progress_state(
                    &cv,
                    &ver,
                    &ch,
                    auto_check,
                    auto_download,
                    transferred,
                    total,
                );
                let _ = app_cb.emit("update-state", progress);
            },
            || {},
        )
        .await;

    match result {
        Ok(()) => {
            // On Windows this launches the installer and exits before returning.
            crate::logfile::info(format!("update {version} downloaded and installing"));
            state.status = "downloaded".to_string();
            state.version = Some(version);
            state.progress = None;
            state.error = None;
        }
        Err(err) => {
            crate::logfile::error(format!("the update download/install failed: {err}"));
            state.status = "error".to_string();
            state.error = Some(err.to_string());
        }
    }
    emit_state(&app, &state);
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_location_yields_the_tag_version() {
        assert_eq!(
            version_from_tag("https://github.com/Aceeee2077/BoolooPet/releases/tag/v0.6.24"),
            Some("0.6.24".to_string())
        );
        // A query string or a trailing slash must not confuse the tag.
        assert_eq!(
            version_from_tag("/releases/tag/v0.6.24/?from=redirect"),
            Some("0.6.24".to_string())
        );
        assert_eq!(
            version_from_tag("https://mirror.example.com/0.6.24"),
            Some("0.6.24".to_string())
        );
        // Not a version: the landing page and the `latest` slug.
        assert_eq!(
            version_from_tag("https://github.com/Aceeee2077/BoolooPet/releases"),
            None
        );
        assert_eq!(
            version_from_tag("https://github.com/Aceeee2077/BoolooPet/releases/latest"),
            None
        );
    }

    #[test]
    fn newer_versions_are_compared_numerically() {
        assert!(is_newer("0.6.10", "0.6.9"));
        assert!(!is_newer("0.6.9", "0.6.10"));
        assert!(!is_newer("0.6.10", "0.6.10"));
        assert!(!is_newer("not-a-version", "0.6.10"));
    }

    #[test]
    fn the_check_cache_survives_a_json_round_trip() {
        let cache = CheckCache {
            checked_at: 1_700_000_000_000,
            version: Some("0.6.24".to_string()),
            notes: Some("notes".to_string()),
            source: "github".to_string(),
        };
        let raw = serde_json::to_string(&cache).unwrap();
        assert!(raw.contains("\"checkedAt\""));
        let back: CheckCache = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.checked_at, 1_700_000_000_000);
        assert_eq!(back.version.as_deref(), Some("0.6.24"));
        assert_eq!(back.source, "github");
    }
}
