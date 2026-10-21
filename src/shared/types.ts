// ============================================================================
// Booloo shared type definitions
// This file contains only type declarations (no runtime exports). Compiled as
// a "script file", these types are globally visible in the renderer without any
// imports. Since the renderer files (lite-app.ts / lite-settings.ts) are single
// scripts (no import/export), the module system is deliberately avoided here so
// every file can use the types directly.
// ============================================================================

/** Pet skin (legacy IDs dog/default now display the built-in fox/rabbit art). */
/**
 * Bulu is the only built-in character. `custom` is one imported picture (it
 * breathes and reacts, but has no walk or sleep of its own); `pack` is an
 * installed pet pack — a folder of a sprite sheet plus its animations, named by
 * `currentPetId` (see src-tauri/src/petpack.rs). Older installs may still have
 * 'cat' / 'dog' / 'default' / 'robot' persisted — src-tauri/src/config.rs
 * migrates those to 'bulu' on load.
 */
type PetSkin = 'bulu' | 'custom' | 'pack';

/** UI language */
type Locale = 'zh' | 'en';

/**
 * The stored language setting: a concrete locale, or `system` to follow the OS
 * language. The backend resolves `system` before handing a dictionary over, so
 * everything the renderer renders is always a concrete Locale.
 */
type LocalePreference = Locale | 'system';

/** Software update release channel */
type UpdateChannel = 'stable' | 'prerelease';

/** Live software-update state (kept in the main process, mirrored to settings UI) */
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  /** Updates are not wired up in this build yet (Tauri migration) */
  | 'unsupported'
  | 'dev';

/** One download-progress snapshot (electron-updater ProgressInfo) */
interface UpdateProgressInfo {
  /** 0..100 */
  percent: number;
  /** Bytes transferred in this download session */
  transferred: number;
  /** Total bytes to download */
  total: number;
  /** Current download speed in bytes/second */
  bytesPerSecond: number;
}

/** Snapshot shared between the main process and settings / tray / pet UI */
interface UpdateState {
  status: UpdateStatus;
  /** Current running version (without a leading v) */
  currentVersion: string;
  /** New version being offered / downloaded (without a leading v) */
  version?: string;
  progress?: UpdateProgressInfo;
  /** GitHub release notes for the offered version, when fetchable */
  notes?: string;
  /** Localized error message (status === 'error') */
  error?: string;
  /**
   * Manual GitHub release page, offered when this build cannot update itself.
   * The lite edition has no URL-opener plugin, so Settings renders it as
   * selectable text instead of launching a browser from the renderer.
   */
  manualUrl?: string;
  /** Epoch ms of the last successful check (survives restarts via the cache) */
  lastChecked?: number;
  /** This snapshot is the cached result because the latest check could not run */
  stale?: boolean;
  autoCheck: boolean;
  autoDownload: boolean;
  channel: UpdateChannel;
}

/**
 * One point of the daily affinity growth history
 */
interface AffinityPoint {
  /** Local date YYYY-MM-DD */
  date: string;
  /** Affinity value on that date */
  value: number;
}

/** Display mode for the custom appearance (image or 3D model) */
type CustomImageMode = 'single' | 'sheet';

/** Animation state */
type PetState = 'idle' | 'walking' | 'sleeping' | 'click';

/**
 * A rectangle on the 300x300 pet canvas, in canvas pixels.
 *
 * Used for everything that needs to point at the pet: its visible silhouette
 * (`petBox`), the rectangle its art was drawn into (`petDrawRect`), the opaque box
 * handed to the native window for edge snapping (`__boolooVisualBounds`), and the
 * anchor coordinate space the accessory system normalizes against.
 */
interface PetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Native file drop coordinates are physical pixels within the pet webview. */
interface PetFileDrop {
  paths: string[];
  position: { x: number; y: number };
}

/** i18n dictionary value: a string, or an array (e.g. the click speech lines) */
type I18nValue = string | string[];

/** Payload returned by the main process for the renderer's i18n */
interface I18nPayload {
  locale: Locale;
  dict: Record<string, I18nValue>;
}

/** Legacy shape of the renderer i18n handle (the lite pages use lite-i18n.ts globals). */
interface BoolooI18n {
  /** Translate a key; unknown keys fall back to the key itself. */
  t(key: string, params?: Record<string, string | number>): string;
  /** Translate an array-valued key (e.g. the click speech lines). */
  tArray(key: string): string[];
  /** Set the active locale + dictionary (provided by the main process via IPC). */
  setLocaleData(locale: Locale, dict: Record<string, I18nValue>): void;
  getLocale(): Locale;
}

/**
 * Import request for a custom accessory. The backend opens the file picker
 * itself, so this carries only the metadata the user filled in.
 */
interface AccessoryImportRequest {
  name: string;
  /** Wardrobe category the card is filed under. */
  category?: string;
  slot: AccessorySlot;
  anchor?: AccessoryAnchorName;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  scale?: number;
  /** Painter's-algorithm z-index of the imported art. */
  zIndex?: number;
  /** Start with a gentle spring (default true). */
  physics?: boolean;
  description?: string;
}

/** What `importAccessory` reports back. */
interface AccessoryImportResult {
  ok: boolean;
  /** The freshly created definition (already registry-shaped). */
  accessory?: UserAccessoryDefinition;
  /** Localized failure reason. */
  error?: string;
}

/** Partial edit applied to an installed accessory. */
interface AccessoryUpdateRequest {
  name?: string;
  slot?: AccessorySlot;
  anchor?: AccessoryAnchorName;
  category?: string;
  transform?: Partial<AccessoryTransform>;
  physics?: boolean;
}

/** Result of an update / delete. */
interface AccessoryMutationResult {
  ok: boolean;
  accessory?: UserAccessoryDefinition;
  error?: string;
}

/**
 * One installed pet pack, as the backend lists it.
 *
 * `manifest` is the normalized PetDefinition (src/shared/petpack-types.ts) the
 * pet window draws from; `url` is a data URL for small sheets, and the renderer
 * falls back to `spritesheet` (an absolute path) through `convertFileSrc`.
 */
interface LitePetPackEntry {
  id: string;
  displayName: string;
  description?: string;
  author?: string;
  version?: string;
  /** Absolute path of the installed folder. */
  dir: string;
  /** Absolute path of the sprite sheet inside that folder. */
  spritesheet: string;
  /** Ready-to-draw URL, or null when the sheet was too large to inline. */
  url: string | null;
  manifest: PetDefinition;
}

/** Answer of `pet_list`. */
interface PetPackListResult {
  ok: boolean;
  pets?: LitePetPackEntry[];
}

/** Answer of `pet_import` / `pet_export` / `pet_remove`. */
interface PetPackActionResult {
  ok: boolean;
  /** The user closed the dialog — not a failure, and nothing to report. */
  cancelled?: boolean;
  /** The freshly installed pack (import only). */
  pet?: LitePetPackEntry;
  /** Where the copy landed (export only). */
  path?: string;
  /** Localized failure reason. */
  error?: string;
}

/** Answer of `pet_editor_open` / `pet_editor_pick`. */
interface PetEditorDraftResult {
  ok: boolean;
  /** The user closed the dialog — not a failure, and nothing to report. */
  cancelled?: boolean;
  /** The manifest to edit, or null when opening a brand-new pack. */
  manifest?: PetDefinition | null;
  /** File name of the sheet in the draft folder, e.g. `sheet.png`. */
  sheet?: string;
  /** Ready-to-draw URL, or null when the sheet was too large to inline. */
  url?: string | null;
  /** Absolute path of the draft sheet, the fallback preview source. */
  path?: string;
  /** Natural pixel size of the sheet, or null when it could not be read. */
  width?: number | null;
  height?: number | null;
  /** Localized failure reason. */
  error?: string;
}

/** Answer of `pet_save`. */
interface PetSaveResult {
  ok: boolean;
  /** The pack as it now sits on disk. */
  pet?: LitePetPackEntry;
  /** Localized failure reason. */
  error?: string;
}

/** Answer of `export_diagnostics`. */
interface DiagnosticsResult {
  ok: boolean;
  /** The user closed the folder picker — not a failure, and nothing to report. */
  cancelled?: boolean;
  /** The folder the bundle was written to. */
  path?: string;
  /** Localized failure reason. */
  error?: string;
}

/** Answer of `backup_export` / `backup_import`. */
interface BackupResult {
  ok: boolean;
  /** The user closed the folder picker — not a failure, and nothing to report. */
  cancelled?: boolean;
  /** The backup folder written to / restored from. */
  path?: string;
  /** Localized failure reason. */
  error?: string;
}

/** Custom image query / selection result */
interface CustomImageResult {  ok: boolean;
  /** pet-custom:// resource URL, can be assigned directly to img.src / GLTFLoader */
  url?: string;
  /** Currently configured display mode */
  mode?: CustomImageMode;
  /** Absolute path of the image on disk */
  path?: string;
  /** Failure reason */
  error?: string;
  /** The stored raster has already been converted to a transparent cutout. */
  cutoutApplied?: boolean;
  /** Anchor table (skill `anchors.json` format) found next to the custom image.
   *  When absent the renderer derives anchors from the pet's silhouette. */
  anchors?: unknown;
  /** Accessory config items (skill format) found next to the custom image.
   *  When empty the built-in catalog is used. */
  accessories?: unknown[];
  /** Frame-sequence manifest (`custom/frames/manifest.json`) when present. Actions
   *  that declare `frames` play those PNGs instead of the single still image. */
  frames?: unknown;
}

/**
 * Payload for the cutout mask editor: the staged picture plus the keep-mask the
 * Rust pass generated for it. Both are data URLs at the editor's working
 * resolution, so the canvas stays untainted and brush strokes can be read back.
 */
interface MaskPreviewResult {
  ok: boolean;
  /** Working resolution of `original` / `mask` (never larger than 1600 px on the long edge). */
  width?: number;
  height?: number;
  /** The staged picture, as picked. */
  original?: string;
  /** White RGBA PNG whose alpha channel is the keep factor (0 = removed). */
  mask?: string;
  /** Kept pixels / total, 0..1 */
  subject?: number;
  /** The automatic pass removed a usable amount of background. */
  applied?: boolean;
  /** The pass would have eaten the subject, so the whole picture was kept. */
  rejected?: boolean;
  /** Strength / feather actually used (falls back to the stored settings). */
  tolerance?: number;
  feather?: number;
  error?: string;
}

/**
 * The settings panel's cutout preview.
 *
 * `url` is the staged picture composited with the keep-mask by the same Rust pass
 * `custom_commit` uses, so the panel never keys the photo itself and the preview
 * cannot disagree with the saved result.
 */
interface CutoutPreviewResult {
  ok: boolean;
  /** The composited picture as a data URL (PNG, alpha already applied). */
  url?: string;
  width?: number;
  height?: number;
  /** Kept pixels / total, 0..1. */
  subject?: number;
  /** The pass removed a usable amount of background. */
  applied?: boolean;
  /** Nothing to remove (or the subject would have been eaten): original kept. */
  rejected?: boolean;
  tolerance?: number;
  error?: string;
}

/** App configuration (persisted to userData/config.json) */
interface AppConfig {
  /** Show a short pet reaction when files are dropped onto its visible body. */
  fileDropReactions?: boolean;
  /** Bring the pet to the screen center at the chosen standing interval. */
  standReminderEnabled?: boolean;
  standReminderMinutes?: number;
  /** Health plan: remind the user to look away from the screen (20-20-20). */
  eyeRestEnabled?: boolean;
  eyeRestMinutes?: number;
  /** Health plan: remind the user to drink some water. */
  waterEnabled?: boolean;
  waterMinutes?: number;
  /**
   * Per local-day counters, keyed `YYYY-MM-DD` (see src/renderer/lite-day.ts):
   * how often the pet was clicked and how often each health reminder fired.
   * Missing days simply have no entry — the heatmap draws them as empty rather
   * than as zero, which is what "the app was not running" deserves.
   */
  dailyStats?: Record<string, DailyStat>;
  /**
   * Local reminders ("18:00 交周报") the pet walks over to announce. Kept in the
   * config so a reminder survives a restart; the pet window is what fires them.
   */
  reminders?: PetReminder[];
  /** Let the pet react to CPU / memory / battery state (see `getSystemLoad`). */
  loadAwareness?: boolean;
  /** Active built-in skin id or imported PetPack id. */
  currentPetId: string;
  /** Pet skin */
  skin: PetSkin;
  /** Animation speed multiplier 0.5 ~ 2 */
  animSpeed: number;
  /** Window opacity 0.5 ~ 1 */
  opacity: number;
  /** Launch at startup */
  autoLaunch: boolean;
  /** Display mode for the custom appearance: single=single image / sheet=sprite sheet / model=3D model */
  customImageMode: CustomImageMode;
  /** Custom image path (for reference) */
  customImagePath: string;
  /** Changes after a confirmed import, even when the saved filename is reused. */
  customImageRevision?: number;
  /** Cutout color tolerance 8 ~ 60 (higher = more aggressive background removal) */
  cutoutTolerance: number;
  /** Trace the imported picture with a white silhouette (see lite-app.ts). */
  customOutline?: boolean;
  /** UI language preference (`system` follows the OS language) */
  locale: LocalePreference;
  /**
   * Wardrobe: what the pet is wearing, one accessory id per slot
   * (`effects` is a list — see src/shared/accessory-types.ts). Persisted here so
   * the equipment survives a restart with no separate storage. A config file
   * written before the wardrobe existed simply has no such key.
   */
  equippedAccessories: EquippedAccessories;
  /** Draw the anchor / frame debug overlay for the accessory system on the pet. */
  accessoryDebug: boolean;
  /**
   * Pet needs (0..100). Read by behavior conditions — `sleep` requires low energy,
   * `dance` a good mood — and nudged by interaction and by behaviors' `effects`.
   * Drifts on a slow tick, so the numbers survive a restart without needing a
   * simulation clock.
   */
  petStats: PetStatsSnapshot;
  /** Affinity with the pet (0 ~ 100, grows when you interact: click / drag / file drop) */
  affinity: number;
  /** Interaction stats: first day the app was launched (YYYY-MM-DD) */
  statsFirstSeen: string;
  /** Interaction stats: distinct launch dates (YYYY-MM-DD) */
  statsDays: string[];
  /** Interaction stats: total clicks on the pet */
  statsClicks: number;
  /** Affinity growth history (one snapshot per interaction day, newest last) */
  affinityHistory: AffinityPoint[];
  /** Hourly chime: the pet jumps and announces the hour */
  hourlyChime: boolean;
  /** Autonomous movement: the pet walks / runs / jumps around the desktop on its own
   *  (stays awake instead of auto-sleeping while enabled) */
  autoMove: boolean;
  /** On-screen size multiplier for the pet art (0.75 ~ 1.5). The window itself stays 300×300. */
  petScale: number;
  /** Keep the pet on the display it currently sits on (off = allow it to cross monitors) */
  stayOnOneDisplay: boolean;
  /** Snap flush to the nearest screen edge when a drag ends */
  snapToEdge: boolean;
  /** Update: check for new GitHub Releases shortly after startup (packaged builds) */
  updateAutoCheck: boolean;
  /** Update: download a found release automatically in the background */
  updateAutoDownload: boolean;
  /** Update: stable releases only, or include pre-releases */
  updateChannel: UpdateChannel;
  /** Update: explicit proxy URL ("" = follow the OS proxy settings) */
  updateProxy: string;
  /** Update: comma / newline separated mirror manifests or release pages */
  updateMirror: string;
  /** Update: extra PEM root certificate for a mirror behind a private CA ("" = none) */
  updateCaCert: string;
}

/** One local day's counters behind the click heatmap and the health summary. */
interface DailyStat {
  /** Times the pet was clicked (a tap, not a drag). */
  clicks?: number;
  /** Times the standing reminder was delivered. */
  stand?: number;
  /** Times the look-away reminder was delivered. */
  eye?: number;
  /** Times the drink-water reminder was delivered. */
  water?: number;
  /**
   * Affinity points earned that day. Kept per day so the daily cap survives a
   * restart; nothing draws it yet.
   */
  affinity?: number;
}

/**
 * One reminder the user left for the pet.
 *
 * `at` is the ms epoch it should be announced at. Reminders live in the config
 * file rather than a store of their own: the list is small, it has to survive a
 * restart, and the pet window already receives every config update.
 */
interface PetReminder {
  /** Stable id so the pet window can tell a fired reminder from a fresh one. */
  id: string;
  /** What the pet holds up on its sign. */
  text: string;
  /** Announce time, ms epoch. */
  at: number;
}

/**
 * Coarse machine state behind the pet's load reactions.
 *
 * `null` means "this platform does not report it" and is deliberately distinct
 * from 0 — a desktop has no battery, which is not the same as an empty one.
 */
interface SystemLoad {
  /** False when the platform reports nothing at all (see src-tauri/src/load.rs). */
  available: boolean;
  /** Busy CPU share 0..100; null until a second sample exists. */
  cpu: number | null;
  /** Used memory share 0..100. */
  memory: number | null;
  /** Battery charge 0..100, or null on a machine without one. */
  batteryPercent: number | null;
  /** True while the machine runs on wall power (a full battery still counts). */
  charging: boolean;
}

/**
 * The window positions that keep the pet's visible box inside its work area —
 * the box a thrown pet bounces inside.
 *
 * Physical pixels, computed by the main process (only it knows the monitor scale
 * factor); `ok` is false when there is no monitor to ask, and the renderer then
 * leaves the pet where it was dropped rather than guessing a boundary.
 */
interface WindowFlightBounds {
  ok: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Space between the pet's visible box and the sides / bottom of the work area. */
interface WindowEdgeGaps {
  /** Physical px from the visible box's left edge to the work area's left edge. */
  left: number;
  /** Physical px from the visible box's right edge to the work area's right edge. */
  right: number;
  /** Physical px from the visible box's bottom to the work area's bottom. */
  bottom: number;
  /** Work-area size in physical px (diagnostics). */
  workWidth: number;
  workHeight: number;
}

/** Weather reported by the main process (free APIs: ipwho.is for location + Open-Meteo) */
interface WeatherResult {  ok: boolean;
  /** City / region name (localized by the API) */
  city?: string;
  /** Temperature in °C */
  temp?: number;
  /** WMO weather code */
  code?: number;
  /** Local date YYYY-MM-DD */
  date?: string;
  /** Failure reason */
  error?: string;
}

/** API exposed to the renderer by the preload script via contextBridge */
interface PetApi {
  /** React to files dropped on the native pet window. */
  onFileDrop(cb: (drop: PetFileDrop) => void): () => void;
  /** Play an action chosen from the pet's context menu. */
  onPetAction(cb: (action: string) => void): () => void;
  /** Feeding tray / cat teaser chosen from the pet's context menu. */
  onPetCare(cb: (action: string) => void): () => void;
  /** Ask the pet window to open the tray, start the teaser or eat one treat
   *  ("tray" | "toy" | "feed:<id>"); the settings panel feeds through this too. */
  care(action: string): void;
  listPets(): Promise<PetDefinition[]>;
  importPet(folder: boolean, replace: boolean): Promise<PetDefinition | null>;
  removePet(id: string): Promise<void>;
  savePet(id: string, manifest: PetDefinition): Promise<PetDefinition>;
  exportPet(id: string): Promise<string | null>;
  onPetsChanged(cb: () => void): () => void;
  petAssetUrl(path: string): string | undefined;
  /** Move the pet window by a delta (dx/dy) */
  moveWindow(dx: number, dy: number): void;
  /** Move the pet window to absolute screen coordinates (clamped to the display work
   *  area). Deliberately never edge-snaps: this is what a thrown pet flies on, and the
   *  magnet must not bend a trajectory or a landing. */
  moveWindowTo(x: number, y: number): Promise<void> | void;
  /** Target native window position that puts the visible pet at the work-area center. */
  getWindowCenterTarget(visualBounds?: PetBox): Promise<[number, number]>;
  /** Begin a drag: main captures the window position + cursor offset (anchor) synchronously. */
  dragBegin(visualBounds?: PetBox): void;
  /** Continue a drag; main targets the window at its own live cursor minus the anchor offset. */
  dragMove(): void;
  /** End a drag and release the main-process cursor/window anchor. `dock` (default
   *  true) lets main snap the pet to the nearest screen edge; the renderer passes
   *  false when the gesture is a throw, so a flick keeps its release position. */
  dragEnd(visualBounds?: PetBox, dock?: boolean): void;
  /** Get the pet window's current position [x, y] */
  getWindowPosition(): Promise<number[]>;
  /** Reset to the center of the screen */
  resetPosition(): void;
  /** Dynamic click-through: true=ignore the mouse (transparent areas click through to the desktop, Windows only) */
  setClickThrough(enabled: boolean): void;
  /** Read the full configuration */
  getConfig(): Promise<AppConfig>;
  /** Partially update the configuration and return the latest one */
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
  /** Open the settings panel window */
  openSettings(section?: string): void;
  /** Close the native settings window */
  closeSettings(): void;
  /** Quit the app */
  quitApp(): void;
  /** Show the context menu */
  showContextMenu(): void;
  /** Run an entry of the right-click menu
   *  ('settings' | 'reminders' | 'reset' | 'quit' | 'action:<name>' | 'care:<action>') */
  petMenuAction(action: string): void;
  /** Dismiss the right-click menu window */
  closePetMenu(): void;
  /** Query the auto-launch status */
  autoLaunchGet(): Promise<boolean>;
  /** Set auto-launch, returns the final status */
  autoLaunchSet(enabled: boolean): Promise<boolean>;
  /** Read the current update state (also refreshes persisted preferences) */
  updateGetState(): Promise<UpdateState>;
  /** Manually check for updates from the settings panel (`force` skips the 6 h throttle) */
  updateCheck(force?: boolean): Promise<UpdateState>;
  /** Start / resume the background download of an available update */
  updateDownload(): Promise<UpdateState>;
  /** Restart the app and install an already-downloaded update */
  updateInstall(): Promise<void>;
  /** One-click update: download if needed, then restart & install automatically when ready */
  updateInstallWhenReady(): Promise<UpdateState>;
  /** Subscribe to config changes, returns an unsubscribe function */
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void;
  /** Subscribe to "settings was opened at this section" (right-click shortcuts). */
  onSettingsFocusSection(cb: (section: string) => void): () => void;
  /**
   * Open the project's GitHub page in the default browser. The address lives in
   * the Rust side (src-tauri/src/opener.rs) and this command takes no arguments,
   * so the page cannot use it to launch arbitrary links.
   */
  openProjectPage(): void;
  /**
   * Bundle the local log plus an environment snapshot into a folder the user
   * picks, ready to attach to a bug report.
   */
  exportDiagnostics(): Promise<DiagnosticsResult>;
  /** Show the log file in the OS file manager. */
  revealLog(): void;
  /**
   * Copy the config and pet data out to a folder the user picks, as a
   * `booloo-backup-<date>` folder that can be restored later.
   */
  backupExport(): Promise<BackupResult>;
  /**
   * Replace the current config and pet data with a backup folder the user picks.
   * What was there first is kept aside as `data-before-restore` before the swap.
   */
  backupImport(): Promise<BackupResult>;
  /**
   * Coarse CPU / memory / battery state. Only polled while
   * `AppConfig.loadAwareness` is on; the first call may report a null CPU
   * because load is a delta between two samples.
   */
  getSystemLoad(): Promise<SystemLoad>;
  /** Subscribe to update-state changes (settings progress bar / status / buttons) */
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  /** Read the currently active custom image (userData takes priority, then the project's src/assets/sprites/custom.*) */
  getCustomImage(): Promise<CustomImageResult>;
  /** Open a file picker, copy the selected image into the app data directory and return it */
  pickCustomImage(): Promise<CustomImageResult>;
  /** Stage an image for preview without replacing the active pet. */
  previewCustomImage(): Promise<CustomImageResult>;
  /**
   * Use the staged image after the user confirms its preview. `png` is the
   * composited result of the mask editor (a `data:image/png` URL); without it the
   * staged file is moved into place untouched.
   */
  commitCustomImage(removeBackground: boolean, png?: string): Promise<CustomImageResult>;
  discardCustomImage(): Promise<void>;
  /** Cutout editor: the staged picture + the initial keep-mask from the Rust pass. */
  maskPreview(tolerance?: number, feather?: number): Promise<MaskPreviewResult>;
  /** Cutout editor: open / close the standalone mask window. */
  openMaskEditor(): void;
  closeMaskEditor(): void;
  /** Fired when the mask window is asked to reload (a second import while it is open). */
  onMaskReload(cb: () => void): () => void;
  /**
   * Settings preview of the automatic cutout: the staged picture composited by
   * the Rust pass. Sent instead of keying the photo in the renderer so both
   * paths share one implementation and one tolerance.
   */
  cutoutPreview(tolerance?: number): Promise<CutoutPreviewResult>;
  /** Fired after any confirmed custom-image change, from either window. */
  onCustomImageChanged(cb: () => void): () => void;
  /** Delete the custom image in the app data directory */
  clearCustomImage(): Promise<boolean>;
  /**
   * List the installed pet packs (one folder per pack under
   * %APPCONFIG%/pets). A broken pack is skipped by the backend, never thrown.
   */
  petList(): Promise<PetPackListResult>;
  /** Pick a folder, validate it and install it as a pet pack. */
  petImport(): Promise<PetPackActionResult>;
  /** Copy an installed pack out to a folder the user picks, ready to share. */
  petExport(id: string): Promise<PetPackActionResult>;
  /** Delete an installed pack; the pet falls back to Bulu when it wore it. */
  petRemove(id: string): Promise<PetPackActionResult>;
  /**
   * Open the pack editor on an installed pack, or start a new one when `id` is
   * blank. The sheet is copied into the app's draft folder, so what is returned is
   * a draft to edit rather than the installed pack itself.
   */
  petEditorOpen(id: string): Promise<PetEditorDraftResult>;
  /** Pick a sheet image for the pack being edited and copy it into the draft. */
  petEditorPick(): Promise<PetEditorDraftResult>;
  /** Validate a drafted manifest and install it as `pets/<id>`, replacing the old copy. */
  petSave(manifest: PetDefinition): Promise<PetSaveResult>;
  /**
   * List the user-imported accessories (one folder per item under
   * %APPCONFIG%/accessories). Broken entries are skipped or flagged by the
   * backend, never thrown.
   */
  listAccessories(): Promise<UserAccessoryDefinition[]>;
  /** Pick a picture, copy it in and create its metadata in one step. */
  importAccessory(meta: AccessoryImportRequest): Promise<AccessoryImportResult>;
  /** Update an installed accessory's name / placement (the Placement editor). */
  updateAccessory(id: string, patch: AccessoryUpdateRequest): Promise<AccessoryMutationResult>;
  /** Delete an installed accessory folder; equipped references are pruned. */
  deleteAccessory(id: string): Promise<AccessoryMutationResult>;
  /**
   * Subscribe to "the installed accessory set changed" (an import, a placement
   * edit or a delete made from the settings window). The pet window reloads its
   * registry so the change shows on the pet without a restart.
   */
  onAccessoriesChanged(cb: () => void): () => void;
  /** Get the active locale + dictionary for the renderer's i18n */
  getI18n(): Promise<I18nPayload>;
  /** Get today's weather (main process fetches from free APIs to avoid CORS; cached ~30 min) */
  getWeather(): Promise<WeatherResult>;
  /** Start gliding the pet window horizontally (dir: -1 left / +1 right; speed: px per second) */
  autoMoveStart(dir: number, speed: number): void;
  /** Stop the autonomous window glide */
  autoMoveStop(): void;
  /**
   * How much room the pet's *visible* box has before it touches the side of the
   * work area, in physical pixels. The animation system uses it to stop a walk at
   * the screen edge and to drive `nearScreenEdge` behavior conditions without
   * guessing at DPI scaling.
   */
  windowEdgeGaps(visualBounds: PetBox | null): Promise<WindowEdgeGaps>;
  /**
   * The box a thrown pet bounces inside (`[minX, minY, maxX, maxY]` in physical
   * window coordinates), for the flight the renderer integrates itself.
   */
  flightBounds(visualBounds?: PetBox | null): Promise<WindowFlightBounds>;
  /** Hop the pet window vertically (a parabolic jump of `height` px over `duration` ms) */
  autoJump(height: number, duration: number): void;
  /** Center the pet window on the display it currently sits on */
  centerHere(): void;
  /** Ask the pet window to play an action by id (fire and forget) */
  playPetAction(id: string): void;
  /** Subscribe to "play this action" requests from the tray menu / settings panel */
  onPetAction(cb: (id: string) => void): () => void;
  /**
   * Ask the pet window to preview a single animation *clip*, bypassing behaviors.
   * Used by the developer animation browser to inspect one animation in isolation.
   */
  playPetClip(id: string): void;
  /** Subscribe to clip preview requests from the developer panel. */
  onPetClip(cb: (id: string) => void): () => void;
}

/** The pack editor form exposed on `window` by src/renderer/lite-pack-editor.ts. */
interface PackEditorApi {
  /**
   * Open the editor on an installed pack, or on a brand-new one when `id` is
   * blank. `onSaved` fires after a successful save, letting the panel refresh.
   */
  open(id: string, onSaved?: (pet?: LitePetPackEntry) => void): void;
}

interface Window {
  api: PetApi;
  /** Legacy global from the pre-lite renderer; lite pages call liteT() instead. */
  BoolooI18n: BoolooI18n;
  /** The pack editor form; absent until lite-pack-editor.js has loaded. */
  litePackEditor?: PackEditorApi;
}
