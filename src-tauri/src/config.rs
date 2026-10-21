// ============================================================================
// Config store — the Tauri counterpart of src/shared/config.ts.
//
// The config is kept as a JSON object rather than a mirrored Rust struct: the
// renderer already owns the schema (src/shared/types.ts), so treating it as a
// patchable document avoids two definitions drifting apart.
// ============================================================================

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct ConfigState {
    path: PathBuf,
    value: Mutex<Value>,
}

/// Mirrors `interface AppConfig` in src/shared/types.ts.
///
/// Every key here has a reader — `npm run verify-surface` fails the build when one
/// does not, which is how the residue of the pre-lightweight features (the AI chat
/// panel, the theme switcher, the sound / weather / greeting switches, the photo
/// eye overlay, the update bookkeeping) was found and dropped.
pub fn defaults() -> Value {
    json!({
        "skin": "bulu",
        "currentPetId": "bulu",
        "animSpeed": 1,
        "opacity": 1,
        "autoLaunch": false,
        "customImageMode": "single",
        "customImagePath": "",
        "customImageRevision": 0,
        "cutoutTolerance": 25,
        // Trace the imported picture with a white silhouette. A cutout that is not
        // pixel-perfect reads as ragged on a busy desktop; the outline makes the
        // edge look deliberate. Off by default — Bulu needs no help.
        "customOutline": false,
        "locale": "zh",
        // The wardrobe's saved equipment: slot -> accessory id (see
        // src/shared/accessory-types.ts). Older config files simply do not have
        // it; `fill_missing` adds the empty object and the manager reads that as
        // "nothing equipped".
        "equippedAccessories": {},
        // Reserved with the equipment map above: the accessory system's anchor
        // overlay switch, read by the wardrobe when it lands (docs/accessory-system.md).
        "accessoryDebug": false,
        // Pet needs (0..100) read by behavior conditions. Older config files do
        // not have this key; the defaults below are a content pet.
        "petStats": { "mood": 70, "energy": 80, "hunger": 20 },
        "affinity": 0,
        "statsFirstSeen": "",
        "statsDays": [],
        "statsClicks": 0,
        "affinityHistory": [],
        "hourlyChime": true,
        "autoMove": true,
        "fileDropReactions": true,
        "standReminderEnabled": true,
        "standReminderMinutes": 5,
        // Health plan. The two new items start off: the standing reminder is
        // already on by default, and stacking two more timers on a fresh install
        // would turn the pet into a metronome. They are one click away in
        // Settings → 健康计划.
        "eyeRestEnabled": false,
        "eyeRestMinutes": 20,
        "waterEnabled": false,
        "waterMinutes": 45,
        // Per local-day counters: { "YYYY-MM-DD": { clicks, stand, eye, water } }.
        // Written by the pet window (batched, see `flushDailyStats`) and read by
        // the settings panel's click heatmap. Pruned to the last ~400 days.
        "dailyStats": {},
        // Reminders the user left for the pet: [{ id, text, at }], `at` being the
        // ms epoch to announce at. Small enough to live in this file, and it has
        // to survive a restart, so there is no separate store.
        "reminders": [],
        // Whether the pet reacts to CPU / memory / battery (src-tauri/src/load.rs).
        "loadAwareness": true,
        "petScale": 1,
        "stayOnOneDisplay": true,
        "snapToEdge": false,
        "updateAutoCheck": true,
        "updateAutoDownload": true,
        "updateChannel": "stable",
        // The update check is the one request that has to work from behind a
        // corporate proxy, so both knobs live here rather than in a UI nobody
        // opens: "" = use the OS proxy, otherwise "http://host:port".
        "updateProxy": "",
        // Comma / newline separated mirror endpoints (a latest.json or a release
        // page). Only tried when GitHub itself cannot answer.
        "updateMirror": "",
        // Optional PEM root for a mirror behind a private CA.
        "updateCaCert": ""
    })
}

/// Keys a patch must REPLACE rather than deep-merge.
///
/// `equippedAccessories` is a slot → accessory-id map. Taking a hat off removes
/// the `head` key, and a recursive merge would simply keep the old id — the hat
/// would come back on the next launch, and a config naming a deleted accessory
/// could never be cleaned up from the UI. Everything else keeps the documented
/// merge semantics (a patch touching one field must not wipe the rest).
const REPLACE_ON_PATCH: [&str; 1] = ["equippedAccessories"];

/// Keys this build never reads, dropped from a stored file on load.
///
/// They are the residue of features the lightweight rewrite did not carry over:
/// the AI chat panel and its saved provider profiles, the theme switcher, the
/// sound / weather / proactive-greeting switches, the photo-pet eye overlay, the
/// tunables that are constants now, and the update bookkeeping the Rust updater
/// keeps in memory. Anything needed again is re-added by `fill_missing`, so
/// carrying the old values costs only confusion — and `apiKey` is worse than that:
/// it is a plaintext API key in a file the user is invited to read.
const RETIRED_KEYS: [&str; 31] = [
    "aiEnabled",
    "apiKey",
    "apiBaseUrl",
    "model",
    "aiProviders",
    "aiProviderId",
    "chatMaxTokens",
    "chatTemperature",
    "chatVerbosity",
    "chatEmoji",
    "chatUsageDate",
    "chatUsageMessages",
    "chatUsageTokens",
    "soundEnabled",
    "theme",
    "animDebug",
    "actionAutoIdle",
    "actionDebug",
    "focusMode",
    "focusInterval",
    "statsChats",
    "greetEnabled",
    "weatherEnabled",
    "photoEyes",
    "sleepTimeoutSec",
    "wanderSpeed",
    "activityFrequency",
    "updateDeferredVersion",
    "updateDeferredAt",
    "updateNextAutoCheckAt",
    "updateAutoRetry",
];

/// Recursively merge `patch` into `base` (objects merge, everything else replaces).
fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (key, patch_value) in patch_map {
                if REPLACE_ON_PATCH.contains(&key.as_str()) {
                    base_map.insert(key.clone(), patch_value.clone());
                    continue;
                }
                deep_merge(base_map.entry(key.clone()).or_insert(Value::Null), patch_value);
            }
        }
        (base_slot, patch_value) => *base_slot = patch_value.clone(),
    }
}

/// Recursively copy in keys the stored config does not have yet.
///
/// This must NOT be `deep_merge`: merging the defaults with the overwrite semantics
/// used for patches resets every stored value back to its default on startup — which
/// is exactly what happened before (the chosen pet, size and locale were lost
/// on every relaunch).
fn fill_missing(base: &mut Value, defaults: &Value) {
    let (Value::Object(base_map), Value::Object(default_map)) = (base, defaults) else {
        return;
    };
    for (key, default_value) in default_map {
        match base_map.get_mut(key) {
            Some(existing) => fill_missing(existing, default_value),
            None => {
                base_map.insert(key.clone(), default_value.clone());
            }
        }
    }
}

pub fn init(app: &AppHandle) -> ConfigState {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("config.json");

    let mut value = match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(parsed) => parsed,
            Err(error) => {
                crate::logfile::error(format!(
                    "config.json could not be parsed, starting from defaults: {error}"
                ));
                Value::Object(Map::new())
            }
        },
        // A first run has no file yet; that is expected and not worth a line.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
        Err(error) => {
            crate::logfile::error(format!(
                "config.json could not be read, starting from defaults: {error}"
            ));
            Value::Object(Map::new())
        }
    };
    // Existing users chose a skin before PetPack existed; preserve that selection.
    if value.get("currentPetId").is_none() {
        if let Some(skin) = value.get("skin").and_then(Value::as_str).map(str::to_string) {
            value["currentPetId"] = Value::String(skin);
        }
    }
    migrate_retired_skin(&mut value);
    let before = value.clone();
    // Drop what this build stopped reading, then fill in whatever is missing.
    drop_retired_keys(&mut value);
    fill_missing(&mut value, &defaults());

    let state = ConfigState {
        path,
        value: Mutex::new(value),
    };
    // Write it back when the load changed anything — a migration, or a first run
    // that had no file at all. The document the user is invited to read is then
    // the one this build actually uses, and a dropped key (the old plaintext
    // `apiKey` in particular) does not sit in the file until the next edit.
    if state.snapshot() != before {
        state.persist();
    }
    state
}

/// Map a skin from an older install onto the character that still ships.
///
/// Bulu is the only built-in pet now, so a config that still says `cat` / `dog` /
/// `default` / `robot` would point the pet window at art that is no longer in the
/// bundle. Imported pictures (`custom`) and Bulu itself are left alone.
fn migrate_retired_skin(value: &mut Value) {
    if matches!(
        value.get("skin").and_then(Value::as_str),
        Some("cat" | "dog" | "default" | "robot")
    ) {
        value["skin"] = Value::String("bulu".to_string());
        value["currentPetId"] = Value::String("bulu".to_string());
    }
}

/// Remove the keys listed in `RETIRED_KEYS` from a loaded document.
///
/// A key this build reads again later comes back through `fill_missing`, so this
/// only ever deletes values nothing can use.
fn drop_retired_keys(value: &mut Value) {
    let Some(map) = value.as_object_mut() else {
        return;
    };
    for key in RETIRED_KEYS {
        map.remove(key);
    }
}

impl ConfigState {
    pub fn snapshot(&self) -> Value {
        self.value.lock().unwrap().clone()
    }

    /// Apply a partial patch and return the merged document.
    pub fn apply(&self, patch: &Value) -> Value {
        let mut value = self.value.lock().unwrap();
        deep_merge(&mut value, patch);
        value.clone()
    }

    pub fn get(&self, key: &str) -> Value {
        self.value
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or(Value::Null)
    }

    pub fn persist(&self) {
        let value = self.snapshot();
        match serde_json::to_string_pretty(&value) {
            Ok(raw) => {
                if let Err(error) = fs::write(&self.path, raw) {
                    crate::logfile::error(format!("the config could not be saved: {error}"));
                }
            }
            Err(error) => {
                crate::logfile::error(format!("the config could not be serialized: {error}"));
            }
        }
    }

    /// Swap the whole document for `restored` and return what was written.
    ///
    /// Used by the backup import. The restored file is a complete document, so it
    /// replaces the in-memory copy as a whole rather than merging into it: a merge
    /// would keep keys the backup does not carry, and a later `persist` (the pet
    /// window saves on its own) would then write those back over the restore.
    /// Retired keys are dropped and this build's defaults fill any gaps, exactly
    /// like a fresh load, so an old backup cannot reintroduce a dropped key.
    pub fn replace(&self, restored: Value) -> Value {
        let mut value = restored;
        drop_retired_keys(&mut value);
        fill_missing(&mut value, &defaults());
        {
            let mut guard = self.value.lock().unwrap();
            *guard = value;
        }
        self.persist();
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Regression: merging the defaults into a stored config must not reset the
    /// values the user already chose (that bug wiped every setting on relaunch).
    #[test]
    fn defaults_fill_gaps_without_overwriting() {
        let mut stored = json!({ "skin": "bulu", "petScale": 1.25, "opacity": 0.8 });
        fill_missing(&mut stored, &defaults());

        assert_eq!(stored.get("skin").and_then(|v| v.as_str()), Some("bulu"));
        assert_eq!(stored.get("petScale").and_then(|v| v.as_f64()), Some(1.25));
        assert_eq!(stored.get("opacity").and_then(|v| v.as_f64()), Some(0.8));
        // …while keys the file does not have yet still get their default.
        assert_eq!(
            stored.get("stayOnOneDisplay").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    /// Patches (config_set) keep the overwrite semantics.
    #[test]
    fn deep_merge_overwrites_for_patches() {
        let mut stored = json!({ "skin": "bulu", "opacity": 0.8 });
        deep_merge(&mut stored, &json!({ "skin": "cat" }));
        assert_eq!(stored.get("skin").and_then(|v| v.as_str()), Some("cat"));
        assert_eq!(stored.get("opacity").and_then(|v| v.as_f64()), Some(0.8));
    }

    /// Regression: the keys this build stopped reading are dropped from the file on
    /// load, and nothing that is still in use goes with them. `apiKey` matters most
    /// — it is the plaintext API key of a feature that no longer exists.
    #[test]
    fn retired_keys_are_dropped_on_load() {
        let mut stored = json!({
            "skin": "bulu",
            "apiKey": "sk-do-not-keep-me",
            "theme": "dark",
            "updateDeferredVersion": "0.5.0",
            "petScale": 1.25,
        });
        drop_retired_keys(&mut stored);

        assert!(stored.get("apiKey").is_none(), "the plaintext key must not survive");
        assert!(stored.get("theme").is_none());
        assert!(stored.get("updateDeferredVersion").is_none());
        assert_eq!(stored.get("petScale").and_then(|v| v.as_f64()), Some(1.25));
        assert_eq!(stored.get("skin").and_then(|v| v.as_str()), Some("bulu"));
    }

    /// A key cannot be shipped and retired at once: retiring it would delete a
    /// live setting on every launch.
    #[test]
    fn retired_keys_are_not_shipped() {
        let shipped = defaults();
        for key in RETIRED_KEYS {
            assert!(shipped.get(key).is_none(), "{key} is retired but still in defaults()");
        }
    }

    /// Regression: removing a key from the equipment map has to stick, or an
    /// unequipped hat reappears on the next launch.
    #[test]
    fn deep_merge_replaces_the_equipment_map() {
        let mut stored = json!({ "equippedAccessories": { "head": "cowboy_hat", "neck": "red_scarf" } });
        deep_merge(&mut stored, &json!({ "equippedAccessories": { "neck": "red_scarf" } }));
        let gear = stored.get("equippedAccessories").unwrap();
        assert!(gear.get("head").is_none(), "unequipping must remove the slot key");
        assert_eq!(gear.get("neck").and_then(|v| v.as_str()), Some("red_scarf"));

        deep_merge(&mut stored, &json!({ "equippedAccessories": {} }));
        assert_eq!(
            stored.get("equippedAccessories").unwrap().as_object().unwrap().len(),
            0
        );
    }

    /// Everything else still merges, so a one-field patch cannot wipe a section.
    #[test]
    fn deep_merge_still_merges_nested_objects() {
        let mut stored = json!({ "update": { "a": 1, "b": 2 } });
        deep_merge(&mut stored, &json!({ "update": { "a": 9 } }));
        assert_eq!(stored["update"]["a"], 9);
        assert_eq!(stored["update"]["b"], 2);
    }

    /// An install from before the line-up was trimmed has to come back as Bulu —
    /// otherwise the pet window asks for art that is no longer in the bundle.
    #[test]
    fn retired_skins_migrate_to_bulu() {
        for retired in ["cat", "dog", "default", "robot"] {
            let mut stored = json!({ "skin": retired, "currentPetId": retired });
            migrate_retired_skin(&mut stored);
            assert_eq!(stored["skin"], "bulu", "{retired} should migrate");
            assert_eq!(stored["currentPetId"], "bulu", "{retired} should migrate");
        }
        // The two skins that still exist are left exactly as they are.
        for kept in ["bulu", "custom"] {
            let mut stored = json!({ "skin": kept, "currentPetId": kept });
            migrate_retired_skin(&mut stored);
            assert_eq!(stored["skin"], kept);
            assert_eq!(stored["currentPetId"], kept);
        }
    }

    /// A restore replaces the document as a whole: keys the restored file does
    /// not carry are dropped (not kept from the running copy), this build's
    /// defaults still fill the gaps, and the file on disk matches the memory.
    #[test]
    fn replace_swaps_the_whole_document() {
        let dir = std::env::temp_dir().join(format!("booloo-config-replace-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let state = ConfigState {
            path: path.clone(),
            value: Mutex::new(json!({ "skin": "bulu", "petScale": 1.25, "keepMe": true })),
        };

        let merged = state.replace(json!({ "skin": "custom", "opacity": 0.5 }));

        assert_eq!(merged.get("skin").and_then(Value::as_str), Some("custom"));
        assert_eq!(merged.get("opacity").and_then(Value::as_f64), Some(0.5));
        assert!(merged.get("keepMe").is_none(), "a key the backup lacks is dropped, not kept");
        assert!(merged.get("petScale").is_some(), "defaults still fill the gaps");
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written, merged, "the file on disk is what the memory holds");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
