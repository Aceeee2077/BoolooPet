/** Small Tauri bridge used by the lightweight pet and settings pages. */
(() => {
  type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  type Listen = (name: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;
  const tauri = (window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke; convertFileSrc?: (path: string) => string }; event?: { listen?: Listen } };
  }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  const call = <T>(name: string, args?: Record<string, unknown>) =>
    invoke ? invoke(name, args) as Promise<T> : Promise.reject(new Error('Tauri unavailable'));
  const send = (name: string, args?: Record<string, unknown>) => {
    void call(name, args).catch(error => console.error(`[lite-api] ${name}:`, error));
  };
  const urlOf = (path?: string) => path && tauri?.core?.convertFileSrc ? tauri.core.convertFileSrc(path) : undefined;
  const bounds = () => (window as unknown as { __boolooVisualBounds?: () => PetBox }).__boolooVisualBounds?.();

  function subscribe<T>(name: string, callback: (value: T) => void) {
    let stop: (() => void) | null = null;
    let closed = false;
    void tauri?.event?.listen?.(name, event => callback(event.payload as T)).then(unlisten => {
      if (closed) unlisten(); else stop = unlisten;
    }).catch(error => console.error(`[lite-api] ${name}:`, error));
    return () => { closed = true; stop?.(); };
  }

  let moveTimer: number | null = null;
  function autoMoveStop() {
    if (moveTimer !== null) window.clearInterval(moveTimer);
    moveTimer = null;
  }
  function autoMoveStart(direction: number, speed: number) {
    autoMoveStop();
    let previous = performance.now();
    moveTimer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      send('window_move', { dx: Math.round(direction * speed * dt), dy: 0, visualBounds: bounds() });
    }, 16);
  }

  /**
   * How often the cursor is looked up while the pet ignores the mouse.
   *
   * While the pet is click-through, the only way to learn that the cursor has
   * arrived on a drawn pixel is to ask — an ignored window receives no pointer
   * events. That lookup is an IPC round trip per probe, and it runs for as long as
   * the pet is transparent, which is most of the day.
   *
   * Two rates: while the cursor is somewhere over the pet's 300×300 window (about
   * to be grabbed, so the answer has to be quick) and while it is somewhere else
   * entirely (only the moment of arrival matters, and a quarter of the rate still
   * catches it well inside the time it takes to move onto the pet).
   */
  const PROBE_NEAR_MS = 70;
  const PROBE_AWAY_MS = 250;

  let reentry: number | null = null;
  function setClickThrough(enabled: boolean) {
    send('set_click_through', { enabled });
    if (reentry !== null) { window.clearTimeout(reentry); reentry = null; }
    if (!enabled) return;
    let failures = 0;
    // A self-rescheduling timeout rather than an interval: the delay depends on
    // where the cursor was last seen.
    const probe = () => {
      reentry = null;
      const test = (window as unknown as { __boolooHitTest?: (x: number, y: number) => boolean }).__boolooHitTest;
      if (!test) { reentry = window.setTimeout(probe, PROBE_AWAY_MS); return; }
      void call<[number, number] | null>('cursor_in_window').then(point => {
        failures = 0;
        if (point && test(point[0], point[1])) { setClickThrough(false); return; }
        reentry = window.setTimeout(probe, point ? PROBE_NEAR_MS : PROBE_AWAY_MS);
      }).catch(() => {
        // A command that keeps failing would leave the pet unclickable forever, so
        // the window is handed back to the cursor instead of being left ignored.
        if (++failures >= 5) { setClickThrough(false); return; }
        reentry = window.setTimeout(probe, PROBE_NEAR_MS);
      });
    };
    reentry = window.setTimeout(probe, PROBE_NEAR_MS);
  }

  const api = {
    getConfig: () => call<AppConfig>('config_get'),
    setConfig: (patch: Partial<AppConfig>) => call<AppConfig>('config_set', { patch }),
    getI18n: () => call<I18nPayload>('i18n_get'),
    onConfigChanged: (callback: (cfg: AppConfig) => void) => subscribe<AppConfig>('config-changed', callback),
    onSettingsFocusSection: (callback: (section: string) => void) => subscribe<string>('settings-focus-section', callback),
    getSystemLoad: () => call<SystemLoad>('system_load'),
    onFileDrop: (callback: (drop: PetFileDrop) => void) => subscribe<PetFileDrop>('tauri://drag-drop', callback),
    onPetAction: (callback: (action: string) => void) => subscribe<string>('pet-action', callback),
    onPetCare: (callback: (action: string) => void) => subscribe<string>('pet-care', callback),
    care: (action: 'tray' | 'toy' | `feed:${string}`) => send('pet_care', { action }),
    getCustomImage: async () => {
      const result = await call<CustomImageResult>('custom_get');
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    previewCustomImage: async () => {
      const result = await call<CustomImageResult>('custom_pick_preview');
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    commitCustomImage: async (removeBackground: boolean, png?: string) => {
      const result = await call<CustomImageResult>('custom_commit', { removeBackground, png });
      return { ...result, url: result.url ?? urlOf(result.path) };
    },
    discardCustomImage: () => call<void>('custom_discard'),
    maskPreview: (tolerance?: number, feather?: number) =>
      call<MaskPreviewResult>('custom_mask_preview', { tolerance, feather }),
    cutoutPreview: (tolerance?: number) =>
      call<CutoutPreviewResult>('custom_cutout_preview', { tolerance }),
    openMaskEditor: () => send('open_mask_editor'),
    closeMaskEditor: () => send('close_mask_editor'),
    onMaskReload: (callback: () => void) => subscribe<void>('mask-reload', callback),
    onCustomImageChanged: (callback: () => void) => subscribe<void>('custom-image-changed', callback),
    // A pack's sheet is a data URL when it is small; otherwise the renderer draws
    // it through the asset protocol, which is why the absolute path is resolved
    // here rather than in the pet loop.
    petList: async () => {
      const result = await call<PetPackListResult>('pet_list');
      return {
        ...result,
        pets: (result.pets ?? []).map(pet => ({ ...pet, url: pet.url ?? urlOf(pet.spritesheet) ?? null })),
      };
    },
    petImport: () => call<PetPackActionResult>('pet_import'),
    petExport: (id: string) => call<PetPackActionResult>('pet_export', { id }),
    petRemove: (id: string) => call<PetPackActionResult>('pet_remove', { id }),
    petEditorOpen: async (id: string) => {
      const result = await call<PetEditorDraftResult>('pet_editor_open', { id });
      return { ...result, url: result.url ?? (result.path ? urlOf(result.path) ?? null : null) };
    },
    petEditorPick: async () => {
      const result = await call<PetEditorDraftResult>('pet_editor_pick');
      return { ...result, url: result.url ?? (result.path ? urlOf(result.path) ?? null : null) };
    },
    petSave: (manifest: PetDefinition) => call<PetSaveResult>('pet_save', { manifest }),
    updateGetState: () => call<UpdateState>('update_get_state'),
    updateCheck: (force?: boolean) => call<UpdateState>('update_check', { force: force ?? false }),
    updateDownload: () => call<UpdateState>('update_download'),
    updateInstall: () => call<void>('update_install'),
    updateInstallWhenReady: () => call<UpdateState>('update_install_when_ready'),
    openProjectPage: () => send('open_project_page'),
    exportDiagnostics: () => call<DiagnosticsResult>('export_diagnostics'),
    revealLog: () => send('reveal_log'),
    backupExport: () => call<BackupResult>('backup_export'),
    backupImport: () => call<BackupResult>('backup_import'),
    onUpdateState: (callback: (state: UpdateState) => void) => subscribe<UpdateState>('update-state', callback),
    dragBegin: (visualBounds?: PetBox) => send('drag_begin', { visualBounds: visualBounds ?? bounds() }),
    dragMove: () => send('drag_move'),
    // `dock: false` on a flick: the throw must start from the cursor's position, so
    // the drop is not allowed to dock the pet to the screen edge first.
    dragEnd: (visualBounds?: PetBox, dock = true) => send('drag_end', { visualBounds: visualBounds ?? bounds(), dock }),
    getWindowPosition: () => call<[number, number]>('window_position'),
    moveWindowTo: (x: number, y: number) => call<void>('window_move_to', { x: Math.round(x), y: Math.round(y) }),
    getWindowCenterTarget: (visualBounds?: PetBox) => call<[number, number]>('window_center_target', { visualBounds: visualBounds ?? bounds() }),
    autoMoveStart,
    autoMoveStop,
    windowEdgeGaps: (visualBounds?: PetBox | null) => call<WindowEdgeGaps>('window_edge_gaps', { visual: visualBounds ?? bounds() ?? null }),
    flightBounds: (visualBounds?: PetBox | null) =>
      call<WindowFlightBounds>('window_flight_bounds', { visual: visualBounds ?? bounds() ?? null }),
    setClickThrough,
    showContextMenu: () => send('show_pet_menu'),
    petMenuAction: (action: string) => send('pet_menu_action', { action }),
    closePetMenu: () => send('close_pet_menu'),
    resetPosition: () => send('window_center_here'),
    closeSettings: () => send('close_settings'),
    autoLaunchGet: () => call<boolean>('autolaunch_get'),
    autoLaunchSet: (enabled: boolean) => call<boolean>('autolaunch_set', { enabled }),
  };
  window.api = api as unknown as PetApi;
  if (document.getElementById('pet-canvas')) {
    setClickThrough(true);
    send('show_pet_window');
  }
})();
