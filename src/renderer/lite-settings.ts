/** Minimal settings with a non-destructive image import preview. */
(() => {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $<HTMLParagraphElement>('image-status');
  const preview = $<HTMLElement>('import-preview');
  const originalCanvas = $<HTMLCanvasElement>('original-preview');
  const resultCanvas = $<HTMLCanvasElement>('result-preview');
  const note = $<HTMLParagraphElement>('preview-note');
  const cutout = $<HTMLInputElement>('remove-background');
  const confirm = $<HTMLButtonElement>('confirm-image');
  const refine = $<HTMLButtonElement>('refine-image');
  const language = $<HTMLElement>('language');
  const languageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#language button[data-locale]'));
  /** The order of the chips; also the slot index the thumb slides to. */
  const LOCALE_ORDER: LocalePreference[] = ['system', 'zh', 'en'];
  const size = $<HTMLInputElement>('pet-size');
  const opacity = $<HTMLInputElement>('opacity');
  const autoMove = $<HTMLInputElement>('auto-move');
  const snapToEdge = $<HTMLInputElement>('snap-to-edge');
  const customOutline = $<HTMLInputElement>('custom-outline');
  const fileDropReactions = $<HTMLInputElement>('file-drop-reactions');
  const standReminder = $<HTMLInputElement>('stand-reminder');
  const standInterval = $<HTMLSelectElement>('stand-interval');
  const standCustom = $<HTMLInputElement>('stand-custom');
  const standCustomLabel = $<HTMLLabelElement>('stand-custom-label');
  const standStatus = $<HTMLParagraphElement>('stand-status');
  const hourlyChime = $<HTMLInputElement>('hourly-chime');
  const loadAwareness = $<HTMLInputElement>('load-awareness');
  const autoLaunch = $<HTMLInputElement>('auto-launch');
  const reminderText = $<HTMLInputElement>('reminder-text');
  const reminderTime = $<HTMLInputElement>('reminder-time');
  const reminderAdd = $<HTMLButtonElement>('reminder-add');
  const reminderList = $<HTMLUListElement>('reminder-list');
  const reminderStatus = $<HTMLParagraphElement>('reminder-status');
  const eyeRest = $<HTMLInputElement>('eye-rest');
  const eyeInterval = $<HTMLSelectElement>('eye-interval');
  const eyeCustom = $<HTMLInputElement>('eye-custom');
  const eyeCustomLabel = $<HTMLLabelElement>('eye-custom-label');
  const water = $<HTMLInputElement>('water');
  const waterInterval = $<HTMLSelectElement>('water-interval');
  const waterCustom = $<HTMLInputElement>('water-custom');
  const waterCustomLabel = $<HTMLLabelElement>('water-custom-label');
  const healthStatus = $<HTMLParagraphElement>('health-status');
  const heatmapGrid = $<HTMLElement>('heatmap-grid');
  const heatmapSummary = $<HTMLElement>('heatmap-summary');
  const heatmapYearLabel = $<HTMLElement>('heatmap-year');
  const heatmapPrev = $<HTMLButtonElement>('heatmap-prev');
  const heatmapNext = $<HTMLButtonElement>('heatmap-next');
  const summaryRange = $<HTMLElement>('summary-range');
  const summaryDays = $<HTMLElement>('summary-days');
  const summaryClicks = $<HTMLElement>('summary-clicks');
  const summaryStand = $<HTMLElement>('summary-stand');
  const summaryEye = $<HTMLElement>('summary-eye');
  const summaryWater = $<HTMLElement>('summary-water');
  const summaryAffinity = $<HTMLElement>('summary-affinity');
  const summaryLine = $<HTMLElement>('summary-line');
  const reportRange = $<HTMLElement>('report-range');
  const reportDays = $<HTMLElement>('report-days');
  const reportClicks = $<HTMLElement>('report-clicks');
  const reportStand = $<HTMLElement>('report-stand');
  const reportEye = $<HTMLElement>('report-eye');
  const reportWater = $<HTMLElement>('report-water');
  const reportAffinity = $<HTMLElement>('report-affinity');
  const reportLines = $<HTMLElement>('report-lines');
  const packs = $<HTMLElement>('packs');
  const importPack = $<HTMLButtonElement>('import-pack');
  const newPack = $<HTMLButtonElement>('new-pack');
  const packStatus = $<HTMLParagraphElement>('pack-status');
  const affinityLevelLabel = $<HTMLElement>('affinity-level');
  const affinityValue = $<HTMLElement>('affinity-value');
  const affinityFill = $<HTMLElement>('affinity-fill');
  const affinityNext = $<HTMLElement>('affinity-next');
  const affinityDays = $<HTMLElement>('affinity-days');
  const affinityFirst = $<HTMLElement>('affinity-first');
  const affinityClicks = $<HTMLElement>('affinity-clicks');
  const careFill = $<HTMLElement>('care-fill');
  const careStatus = $<HTMLParagraphElement>('care-status');
  const careFoods = $<HTMLElement>('care-foods');
  const careMessage = $<HTMLParagraphElement>('care-message');
  const updateVersion = $<HTMLSpanElement>('update-version');
  const updateStatus = $<HTMLSpanElement>('update-status');
  const updateLastCheck = $<HTMLSpanElement>('update-last-check');
  const updateOffline = $<HTMLParagraphElement>('update-offline');
  const updateProgressRow = $<HTMLElement>('update-progress-row');
  const updateProgressBar = $<HTMLElement>('update-progress-bar');
  const updateProgressText = $<HTMLSpanElement>('update-progress-text');
  const updateNotesBox = $<HTMLElement>('update-notes-box');
  const updateNotes = $<HTMLElement>('update-notes');
  const updateManual = $<HTMLParagraphElement>('update-manual');
  const updateAutoCheck = $<HTMLInputElement>('update-auto-check');
  const updateAutoDownload = $<HTMLInputElement>('update-auto-download');
  const checkUpdateButton = $<HTMLButtonElement>('btn-check-update');
  const downloadUpdateButton = $<HTMLButtonElement>('btn-download-update');
  const installUpdateButton = $<HTMLButtonElement>('btn-install-update');
  const exportDiagnosticsButton = $<HTMLButtonElement>('export-diagnostics');
  const revealLogButton = $<HTMLButtonElement>('reveal-log');
  const diagStatus = $<HTMLParagraphElement>('diag-status');
  const backupExportButton = $<HTMLButtonElement>('backup-export');
  const backupImportButton = $<HTMLButtonElement>('backup-import');
  const backupStatus = $<HTMLParagraphElement>('backup-status');
  let candidate: HTMLImageElement | null = null;
  let current: AppConfig | null = null;
  let lastUpdate: UpdateState | null = null;

  function message(value: string, error = false) {
    status.textContent = value;
    status.classList.toggle('error', error);
  }

  function paintCanvas(canvas: HTMLCanvasElement, source: CanvasImageSource, bounds: { x: number; y: number; width: number; height: number }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(160 / bounds.width, 160 / bounds.height);
    const w = bounds.width * scale, h = bounds.height * scale;
    ctx.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height,
      (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  /** Guards against a slow cutout answer painting over a newer choice. */
  let previewSerial = 0;

  /**
   * Paint the "what it will look like" column.
   *
   * With the checkbox off the picture is shown as it is. With it on the Rust pass
   * composites the staged photo — the very pass that bakes the saved PNG — so the
   * preview and the pet can never disagree about the tolerance.
   */
  async function updatePreview(): Promise<void> {
    if (!candidate) return;
    const serial = ++previewSerial;
    let original: LitePreparedImage;
    try {
      original = litePrepareImage(candidate);
    } catch (error) {
      confirm.disabled = true;
      note.textContent = String(error);
      return;
    }
    paintCanvas(originalCanvas, original.canvas, { x: 0, y: 0, width: candidate.naturalWidth, height: candidate.naturalHeight });
    if (!cutout.checked) {
      paintCanvas(resultCanvas, original.canvas, original.bounds);
      note.textContent = liteT('lite.image.transparentNote');
      confirm.disabled = original.visiblePixels === 0;
      return;
    }
    try {
      const preview = await window.api.cutoutPreview();
      if (serial !== previewSerial) return;
      if (preview.ok && preview.url) {
        const image = await liteLoadImage(preview.url);
        if (serial !== previewSerial) return;
        const prepared = litePrepareImage(image);
        paintCanvas(resultCanvas, prepared.canvas, prepared.bounds);
        note.textContent = preview.rejected
          ? liteT('lite.image.cutoutRejected')
          : preview.applied ? liteT('lite.image.confirmHint') : liteT('lite.image.transparentNote');
        confirm.disabled = prepared.visiblePixels === 0;
        return;
      }
      note.textContent = preview.error || liteT('lite.image.cutoutRejected');
    } catch (error) {
      note.textContent = String(error);
    }
    // The pass could not run: show the picture untouched rather than an empty frame.
    if (serial !== previewSerial) return;
    paintCanvas(resultCanvas, original.canvas, original.bounds);
    confirm.disabled = original.visiblePixels === 0;
  }

  /**
   * "2026-10-21 09:30" for the last successful check.
   *
   * Deliberately not `toLocaleString`: the line has to stay one fixed shape in
   * both dictionaries (and in the test harness), and the value is only ever
   * read as "how old is this".
   */
  function formatLastCheck(at: number): string {
    const date = new Date(at);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Paint one update snapshot. The main process pushes a new one for every step
   * (check → available → downloading N% → downloaded), so this is the only place
   * that decides what the buttons and the progress bar show.
   */
  function renderUpdate(state: UpdateState) {
    const previous = lastUpdate;
    lastUpdate = state;
    const running = state.currentVersion ? `v${state.currentVersion}` : '—';
    // The `{v}` keys already spell the leading "v" ("发现新版本 v{v}"), so the
    // placeholders take the bare version.
    const offered = state.version ?? '';
    updateVersion.textContent = running;
    updateStatus.classList.toggle('err', state.status === 'error');
    // Only the error line carries a tooltip with the raw reason.
    updateStatus.title = '';
    switch (state.status) {
      case 'checking': updateStatus.textContent = liteT('settings.updateChecking'); break;
      case 'available':
        updateStatus.textContent = offered ? liteT('settings.updateAvailable', { v: offered }) : liteT('settings.updateIdle');
        break;
      case 'downloading':
        updateStatus.textContent = liteT('settings.updateDownloading', { p: Math.round(state.progress?.percent ?? 0) });
        break;
      case 'downloaded':
        updateStatus.textContent = offered ? liteT('settings.updateDownloaded', { v: offered }) : liteT('settings.updateIdle');
        break;
      case 'up-to-date': updateStatus.textContent = liteT('settings.updateUpToDate', { v: state.currentVersion ?? '' }); break;
      case 'dev': updateStatus.textContent = liteT('settings.updateDev'); break;
      case 'unsupported': updateStatus.textContent = liteT('settings.updateUnsupported'); break;
      case 'error':
        updateStatus.textContent = liteT('settings.updateError');
        updateStatus.title = state.error || '';
        break;
      default: updateStatus.textContent = liteT('settings.updateIdle');
    }

    // Progress snapshots carry no timestamp, so keep the last one painted.
    const checkedAt = state.lastChecked ?? previous?.lastChecked;
    if (checkedAt !== undefined) {
      updateLastCheck.textContent = formatLastCheck(checkedAt);
    } else if (state.status === 'idle') {
      updateLastCheck.textContent = liteT('settings.updateNever');
    }
    // A failed check is not an error line: the status stays on the cached result
    // and this note explains why it may be old.
    updateOffline.hidden = !state.stale;

    const percent = Math.min(100, Math.max(0, Math.round(state.progress?.percent ?? 0)));
    updateProgressRow.hidden = state.status !== 'downloading';
    updateProgressBar.style.width = `${percent}%`;
    updateProgressText.textContent = `${percent}%`;

    checkUpdateButton.disabled = state.status === 'checking' || state.status === 'downloading' ||
      state.status === 'dev' || state.status === 'unsupported';
    // The download button is only needed when the background download is off;
    // otherwise the check already started pulling the bytes.
    downloadUpdateButton.hidden = !(state.status === 'available' && !state.autoDownload);
    installUpdateButton.hidden = state.status !== 'downloaded';

    const notes = state.notes || '';
    updateNotesBox.hidden = !(notes && (state.status === 'available' || state.status === 'downloaded'));
    updateNotes.textContent = notes;

    const manual = state.manualUrl || '';
    const showManual = !!manual && (state.status === 'unsupported' || state.status === 'dev' || state.status === 'error');
    updateManual.hidden = !showManual;
    updateManual.textContent = showManual ? `${liteT('settings.updateManualHint')} ${manual}` : '';
  }

  async function chooseImage() {
    candidate = null;
    preview.hidden = true;
    await window.api.discardCustomImage().catch(() => undefined);
    message(liteT('lite.image.choosing'));
    try {
      const selected = await window.api.previewCustomImage();
      if (!selected.ok || !selected.url) {
        message(selected.error || liteT('lite.image.cancelled'));
        return;
      }
      candidate = await liteLoadImage(selected.url);
      cutout.checked = false;
      preview.hidden = false;
      await updatePreview();
      message(liteT('lite.image.previewHint'));
    } catch (error) {
      candidate = null;
      preview.hidden = true;
      message(liteT('lite.image.previewFailed', { error: String(error) }), true);
      await window.api.discardCustomImage().catch(() => undefined);
    }
  }

  async function cancelImage() {
    candidate = null;
    preview.hidden = true;
    await window.api.discardCustomImage().catch(() => undefined);
    message(liteT('lite.image.cancelled'));
  }

  async function confirmImage() {
    if (!candidate || confirm.disabled) return;
    confirm.disabled = true;
    try {
      const saved = await window.api.commitCustomImage(cutout.checked);
      if (!saved.ok) throw new Error(saved.error || liteT('lite.image.saveFailed'));
      candidate = null;
      preview.hidden = true;
      current = await window.api.getConfig();
      paint(current);
      message(liteT('lite.image.applied'));
    } catch (error) {
      message(liteT('lite.image.notApplied', { error: String(error) }), true);
      confirm.disabled = false;
    }
  }

  /** The minutes actually in effect, clamped the same way the pet window clamps. */
  function reminderMinutes(cfg: AppConfig) {
    const value = Number(cfg.standReminderMinutes);
    return Number.isInteger(value) && value >= 1 && value <= 240 ? value : 5;
  }

  // ---------- the user's own reminders ----------

  // ---------- health plan ----------

  // ---------- affinity ----------
  /**
   * The level, the score, the bar towards the next level and the three lifetime
   * numbers. All of it comes from the config: the pet window is the only writer,
   * and it broadcasts after every batch (see flushStats).
   */
  function paintAffinity(cfg: AppConfig) {
    const value = Math.max(0, Number(cfg.affinity) || 0);
    const level = affinityLevel(value);
    affinityLevelLabel.textContent = affinityLevelName(level);
    affinityValue.textContent = String(value);
    affinityFill.style.width = `${Math.round(affinityProgress(value) * 100)}%`;
    const next = affinityNextAt(value);
    affinityNext.textContent = next === null
      ? liteT('affinity.max')
      : liteT('affinity.next', { n: next - value, name: affinityLevelName(level + 1) });
    affinityDays.textContent = String((cfg.statsDays ?? []).length);
    affinityFirst.textContent = cfg.statsFirstSeen || '—';
    affinityClicks.textContent = String(Number(cfg.statsClicks) || 0);
  }

  // ---------- feeding ----------
  /**
   * The same hunger the pet window drifts and the same three treats, built from
   * the shared CARE_FOODS table (lite-care.ts) so a food can never have one
   * effect on the button and another in the tray.
   */
  function paintCare(cfg: AppConfig) {
    const hunger = careStat(cfg.petStats?.hunger, CARE_NEEDS_DEFAULT.hunger);
    const level = careHungerLevel(hunger);
    careFill.style.width = `${Math.round(hunger)}%`;
    careFill.classList.toggle('hungry', level === 'hungry');
    careFill.classList.toggle('starving', level === 'starving');
    careStatus.textContent = liteT(`lite.care.level.${level}`, { p: Math.round(hunger) });
  }

  /** One button per treat; the click goes through the same relay the menu uses. */
  function buildCareFoods() {
    careFoods.textContent = '';
    for (const food of CARE_FOODS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.food = food.id;
      button.title = liteT('lite.care.foodEffect', {
        hunger: food.hunger, mood: food.mood, energy: food.energy,
      });
      const icon = document.createElement('span');
      icon.textContent = food.icon;
      const name = document.createElement('small');
      name.textContent = liteT(food.nameKey);
      button.append(icon, name);
      button.addEventListener('click', () => {
        const before = current ? careStat(current.petStats?.hunger, CARE_NEEDS_DEFAULT.hunger) : 0;
        if (!careWillEat(before)) {
          careMessage.textContent = liteT('lite.care.full');
          return;
        }
        careMessage.textContent = liteT('lite.care.sent', { name: liteT(food.nameKey) });
        window.api.care(`feed:${food.id}`);
      });
      careFoods.append(button);
    }
  }
  /** Which locale the treat buttons were labelled in, so they are rebuilt once. */
  let careLocale = '';

  /** Intervals offered for the two new habits (the standing one keeps its own list). */
  const EYE_PRESETS = [20, 30, 60];
  const WATER_PRESETS = [30, 45, 60, 90];
  let eyeSignature = '';
  let waterSignature = '';

  /** Same clamp the pet window applies, so both agree on what is in effect. */
  function minutes(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 240 ? number : fallback;
  }

  /**
   * Fill an interval box: the presets, then "custom". A stored value that is not
   * one of the presets leaves the box on "custom" with that number in the field,
   * which is also how the standing reminder has always behaved.
   */
  function fillMinutes(select: HTMLSelectElement, presets: number[], current: number, signature: string) {
    if (signature === select.dataset.signature) return;
    select.dataset.signature = signature;
    select.textContent = '';
    for (const value of presets) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = liteT('lite.health.minutes', { n: value });
      select.append(option);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = liteT('lite.settings.custom');
    select.append(custom);
  }

  /** Show the chosen preset in the box, and the number field only when it is "custom". */
  function paintInterval(
    select: HTMLSelectElement, label: HTMLLabelElement, field: HTMLInputElement,
    presets: number[], current: number,
  ) {
    const custom = !presets.includes(current);
    select.value = custom ? 'custom' : String(current);
    label.hidden = !custom;
    field.value = String(current);
  }

  /** Picking "custom" only reveals the number field; the value is saved after. */
  function revealCustom(select: HTMLSelectElement, label: HTMLLabelElement, field: HTMLInputElement) {
    if (select.value !== 'custom') {
      saveHealth();
      return;
    }
    label.hidden = false;
    field.focus();
    field.select();
  }

  /** Today's counters, straight out of the same buckets the pet writes. */
  function todayStats(cfg: AppConfig): DailyStat {
    return (cfg.dailyStats ?? {})[liteDayKey()] ?? {};
  }

  function paintHealth(cfg: AppConfig) {
    const eyeMinutes = minutes(cfg.eyeRestMinutes, 20);
    const waterMinutes = minutes(cfg.waterMinutes, 45);
    eyeRest.checked = cfg.eyeRestEnabled === true;
    water.checked = cfg.waterEnabled === true;
    fillMinutes(eyeInterval, EYE_PRESETS, eyeMinutes, `eye:${eyeMinutes}:${liteCurrentLocale()}`);
    fillMinutes(waterInterval, WATER_PRESETS, waterMinutes, `water:${waterMinutes}:${liteCurrentLocale()}`);
    paintInterval(eyeInterval, eyeCustomLabel, eyeCustom, EYE_PRESETS, eyeMinutes);
    paintInterval(waterInterval, waterCustomLabel, waterCustom, WATER_PRESETS, waterMinutes);
    const today = todayStats(cfg);
    healthStatus.textContent = liteT('lite.health.today', {
      stand: Number(today.stand) || 0,
      eye: Number(today.eye) || 0,
      water: Number(today.water) || 0,
    });
  }

  function saveHealth() {
    // A custom value is typed in, so it is validated rather than clamped: writing
    // the fallback while the field still shows 999 would look like a bug.
    const chosen = (select: HTMLSelectElement, field: HTMLInputElement) => {
      const value = Number(select.value === 'custom' ? field.value : select.value);
      return Number.isInteger(value) && value >= 1 && value <= 240 ? value : null;
    };
    const eyeMinutes = chosen(eyeInterval, eyeCustom);
    const waterMinutes = chosen(waterInterval, waterCustom);
    if (eyeMinutes === null || waterMinutes === null) {
      healthStatus.textContent = liteT('lite.health.invalid');
      return;
    }
    void window.api.setConfig({
      eyeRestEnabled: eyeRest.checked,
      eyeRestMinutes: eyeMinutes,
      waterEnabled: water.checked,
      waterMinutes,
    }).catch(error => { healthStatus.textContent = liteT('lite.health.failed', { error: String(error) }); });
  }

  // ---------- click heatmap ----------
  /**
   * One whole calendar year, GitHub's shape. The thresholds are the ones asked
   * for: the first shade starts at 10 clicks and the darkest at 100 — days below
   * 10 are drawn as empty, but their exact count is still in the tooltip. The two
   * steps in between are even 30-click bands.
   */
  const HEAT_LEVELS = [10, 40, 70, 100];
  /** Track sizes, matching the `.heatmap-grid` rule in lite-settings.css. */
  const HEAT_COLUMN_PX = 10;
  const HEAT_GUTTER_PX = 16;
  /** Which year the chart shows; the arrows move it, never past the current one. */
  let heatmapYear = new Date().getFullYear();

  function heatLevel(count: number) {
    let level = 0;
    for (const threshold of HEAT_LEVELS) if (count >= threshold) level++;
    return level;
  }

  function dateLocale() {
    return liteCurrentLocale() === 'en' ? 'en' : 'zh-CN';
  }

  function dayLabel(key: string) {
    const date = liteDayStart(key);
    return date ? date.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : key;
  }

  function monthLabel(key: string) {
    const date = liteDayStart(key);
    return date ? date.toLocaleDateString(dateLocale(), { month: 'short' }) : '';
  }

  /** Narrow weekday letters for the left column (2024-01-01 was a Monday). */
  function weekdayLabel(row: number) {
    return new Date(2024, 0, 1 + row).toLocaleDateString(dateLocale(), { weekday: 'narrow' });
  }

  /**
   * The year's first and last day, and the Monday the grid has to start on so
   * every column is one Monday-to-Sunday week.
   */
  function yearRange(year: number) {
    const first = `${year}-01-01`;
    const last = `${year}-12-31`;
    const lead = liteDayWeekday(first);
    return {
      first,
      last,
      start: liteDayShift(first, -lead),
      columns: Math.ceil((lead + liteDayDiff(first, last) + 1) / 7),
    };
  }

  /** Oldest year there is anything to show for (never ahead of this year). */
  function earliestYear(stats: Record<string, DailyStat>) {
    const thisYear = new Date().getFullYear();
    const years = Object.keys(stats)
      .map(key => Number(key.slice(0, 4)))
      .filter(year => Number.isInteger(year));
    return years.length ? Math.min(...years, thisYear) : thisYear;
  }

  function paintHeatmap(cfg: AppConfig) {
    const stats = cfg.dailyStats ?? {};
    const today = liteDayKey();
    const thisYear = Number(today.slice(0, 4));
    heatmapYear = Math.min(heatmapYear, thisYear);
    const { first, last, start, columns } = yearRange(heatmapYear);
    heatmapYearLabel.textContent = String(heatmapYear);
    heatmapPrev.disabled = heatmapYear <= earliestYear(stats);
    heatmapNext.disabled = heatmapYear >= thisYear;
    heatmapGrid.style.gridTemplateColumns =
      `${HEAT_GUTTER_PX}px repeat(${columns}, ${HEAT_COLUMN_PX}px)`;
    heatmapGrid.textContent = '';
    let month = '';
    let total = 0, best = 0, bestDay = '';
    for (let row = -1; row < 7; row++) {
      for (let column = 0; column < columns + 1; column++) {
        const cell = document.createElement('i');
        if (row < 0) {
          // Header row: the month is printed above the first week that reaches
          // into it, so a year starting mid-week still gets its January label on
          // the first column instead of December's.
          cell.className = 'heatmap-month';
          if (column > 0) {
            const weekStart = liteDayShift(start, (column - 1) * 7);
            const inYear = liteDayDiff(first, weekStart) < 0 ? first : weekStart;
            const label = inYear.slice(0, 7);
            if (label !== month) { month = label; cell.textContent = monthLabel(inYear); }
          }
          heatmapGrid.append(cell);
          continue;
        }
        if (column === 0) {
          cell.className = 'heatmap-weekday';
          cell.textContent = row % 2 === 0 ? weekdayLabel(row) : '';
          heatmapGrid.append(cell);
          continue;
        }
        const key = liteDayShift(start, (column - 1) * 7 + row);
        cell.className = 'heatmap-cell';
        if (liteDayDiff(first, key) < 0 || liteDayDiff(last, key) > 0) {
          // Padding around the year: the grid is whole weeks, the year is not.
          cell.setAttribute('data-level', '-2');
          heatmapGrid.append(cell);
          continue;
        }
        if (liteDayDiff(today, key) > 0) {
          // Later this year: drawn exactly like a day with no clicks yet, so the
          // whole year's grid is visible from January instead of the chart
          // stopping at today. The tooltip is what tells the two apart, and the
          // square starts counting the moment the day arrives.
          cell.setAttribute('data-level', '0');
          cell.title = liteT('lite.heatmap.cellFuture', { date: dayLabel(key) });
          heatmapGrid.append(cell);
          continue;
        }
        const count = Number(stats[key]?.clicks) || 0;
        cell.setAttribute('data-level', String(heatLevel(count)));
        cell.title = liteT(count ? 'lite.heatmap.cell' : 'lite.heatmap.cellEmpty',
          { date: dayLabel(key), count });
        if (key === today) cell.setAttribute('data-today', '1');
        total += count;
        if (count > best) { best = count; bestDay = key; }
        heatmapGrid.append(cell);
      }
    }
    heatmapSummary.textContent = total
      ? liteT('lite.heatmap.summary', {
        year: heatmapYear, total, day: dayLabel(bestDay), count: best,
      })
      : liteT('lite.heatmap.empty', { year: heatmapYear });
  }

  /**
   * This week so far — Monday to today — out of the same per-day buckets the
   * heatmap draws, so the two can never disagree. The pet records nothing extra
   * for the report, and a partial week is never compared against a full one.
   */
  function paintSummary(cfg: AppConfig) {
    const today = liteDayKey();
    const totals = summaryTotals(cfg.dailyStats, summaryWeekStart(today), today);
    summaryRange.textContent = liteT('lite.summary.range', {
      from: dayLabel(totals.from), to: dayLabel(totals.to),
    });
    summaryDays.textContent = String(totals.days);
    summaryClicks.textContent = String(totals.clicks);
    summaryStand.textContent = String(totals.stand);
    summaryEye.textContent = String(totals.eye);
    summaryWater.textContent = String(totals.water);
    summaryAffinity.textContent = `+${totals.affinity}`;
    // The streak is a second sentence rather than a row: it is the one number
    // that only means something next to "days together".
    const headline = liteT(summaryHeadlineKey(totals));
    const streak = summaryStreak(cfg.dailyStats, today);
    summaryLine.textContent = streak >= 2
      ? `${headline} ${liteT('lite.summary.streak', { n: streak })}`
      : headline;
  }

  /**
   * The year so far, out of the same buckets the heatmap and the weekly summary
   * draw. Only the current year is shown — the pet prunes its buckets to roughly
   * a year, so there is nothing older to report on.
   */
  function paintReport(cfg: AppConfig) {
    const year = Number(liteDayKey().slice(0, 4));
    const report = yearReport(cfg.dailyStats, year);
    reportRange.textContent = liteT('lite.report.range', {
      from: dayLabel(report.from), to: dayLabel(report.to),
    });
    reportDays.textContent = String(report.days);
    reportClicks.textContent = String(report.clicks);
    reportStand.textContent = String(report.stand);
    reportEye.textContent = String(report.eye);
    reportWater.textContent = String(report.water);
    reportAffinity.textContent = `+${report.affinity}`;
    if (report.days === 0) {
      reportLines.textContent = liteT('lite.report.quiet');
      return;
    }
    const lines = [liteT('lite.report.streakLine', { n: report.streak })];
    if (report.busiest) {
      lines.push(liteT('lite.report.busiest', {
        date: dayLabel(report.busiest.date), count: report.busiest.clicks,
      }));
    }
    if (report.first) lines.push(liteT('lite.report.firstLine', { date: dayLabel(report.first) }));
    reportLines.textContent = lines.join(' ');
  }

  // ---------- pet packs ----------
  /**
   * Installed pet packs, as last listed by the backend.
   *
   * A pack is a whole character (a sheet plus its animations), which is why it
   * gets its own list rather than a third button next to "Bulu" / "my picture":
   * each entry carries a name, an author and three actions.
   */
  let pets: LitePetPackEntry[] = [];
  /** Locale the cards were built with — the labels are translated, so they age. */
  let packsLocale = '';

  function packButton(key: string, action: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.packAction = action;
    button.textContent = liteT(key);
    return button;
  }

  function buildPacks() {
    packsLocale = liteCurrentLocale();
    packs.textContent = '';
    if (!pets.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = liteT('lite.pack.empty');
      packs.append(empty);
      return;
    }
    for (const pet of pets) {
      const card = document.createElement('div');
      card.className = 'pack-card';
      card.dataset.packId = pet.id;
      const name = document.createElement('strong');
      name.textContent = pet.displayName || pet.id;
      const meta = document.createElement('small');
      meta.textContent = [pet.author, pet.version].filter(Boolean).join(' · ');
      // The card is what "wearing this pack" looks like, so it carries the state
      // rather than a separate radio group that could fall out of step with it.
      card.classList.toggle('active', current?.skin === 'pack' && current.currentPetId === pet.id);
      card.append(name);
      if (meta.textContent) card.append(meta);
      // "Edit…" goes last: the first three actions are the ones the card has
      // always carried, and their order is what the list is read by.
      card.append(packButton('lite.pack.use', 'use'), packButton('lite.pack.export', 'export'), packButton('lite.pack.remove', 'remove'), packButton('lite.editor.edit', 'edit'));
      packs.append(card);
    }
  }

  /** Only the selection changed, so the cards do not have to be rebuilt. */
  function paintPackSelection(cfg: AppConfig) {
    for (const card of Array.from(packs.querySelectorAll<HTMLElement>('[data-pack-id]'))) {
      card.classList.toggle('active', cfg.skin === 'pack' && card.dataset.packId === cfg.currentPetId);
    }
  }

  async function refreshPacks() {
    try {
      const list = await window.api.petList();
      pets = list.pets ?? [];
    } catch (error) {
      // A pack that cannot be listed is not worth an error banner: the pet keeps
      // drawing whatever it is already wearing.
      pets = [];
      console.error('[lite-settings] pet packs:', error);
    }
    buildPacks();
  }

  /**
   * Show the in-panel editor on `id` — an installed pack, or blank for a new one.
   *
   * The form itself lives in its own script (lite-pack-editor.ts), so this only
   * hands it the id and takes the refresh back: saving rebuilds the list and
   * reports the new name, while wearing the pack stays the card's "Use" button,
   * which keeps the two jobs from arguing over one click.
   */
  function openEditor(id: string) {
    window.litePackEditor?.open(id, (pet) => {
      void refreshPacks();
      packStatus.classList.remove('error');
      packStatus.textContent = liteT('lite.editor.saved', { name: pet?.displayName ?? pet?.id ?? '' });
    });
  }

  /** `HH:MM` for a time input, in local time. */
  function timeValue(date: Date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Turn what the time input says into an announcement time.
   *
   * A time that has already passed means tomorrow — "07:30" at noon reads as
   * tomorrow morning, which is what someone typing it means.
   */
  function reminderAt(value: string, now = Date.now()): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }

  /** "今天 18:00" / "明天 07:30" / "10/3 09:00" for the list. */
  function reminderWhen(at: number) {
    const date = new Date(at);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const time = timeValue(date);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(date, today)) return liteT('lite.reminders.today', { time });
    if (sameDay(date, tomorrow)) return liteT('lite.reminders.tomorrow', { time });
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }

  function reminderId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Paint the pending list; the delete buttons post the trimmed array back. */
  function paintReminders(cfg: AppConfig) {
    const list = Array.isArray(cfg.reminders) ? [...cfg.reminders] : [];
    list.sort((a, b) => Number(a?.at) - Number(b?.at));
    reminderList.textContent = '';
    if (!list.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = liteT('lite.reminders.empty');
      reminderList.append(empty);
      return;
    }
    for (const item of list) {
      const row = document.createElement('li');
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = reminderWhen(Number(item.at));
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = String(item.text);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', liteT('lite.reminders.remove'));
      remove.title = liteT('lite.reminders.remove');
      remove.addEventListener('click', () => void removeReminder(item.id));
      row.append(when, text, remove);
      reminderList.append(row);
    }
  }

  /** Reminders as they are in the panel's own copy of the config. */
  function reminderListOf(): PetReminder[] {
    return Array.isArray(current?.reminders) ? [...(current as AppConfig).reminders!] : [];
  }

  async function addReminder() {
    const text = reminderText.value.trim();
    if (!text) {
      reminderStatus.textContent = liteT('lite.reminders.invalidText');
      reminderText.focus();
      return;
    }
    const at = reminderAt(reminderTime.value);
    if (!at) {
      reminderStatus.textContent = liteT('lite.reminders.invalidTime');
      reminderTime.focus();
      return;
    }
    try {
      const cfg = await window.api.setConfig({
        reminders: [...reminderListOf(), { id: reminderId(), text, at }],
      });
      paint(cfg);
      reminderText.value = '';
      reminderStatus.textContent = liteT('lite.reminders.added', { text, when: reminderWhen(at) });
    } catch (error) {
      reminderStatus.textContent = liteT('lite.reminders.failed', { error: String(error) });
    }
  }

  async function removeReminder(id: string) {
    try {
      const cfg = await window.api.setConfig({
        reminders: reminderListOf().filter(item => item.id !== id),
      });
      paint(cfg);
      reminderStatus.textContent = liteT('lite.reminders.removed');
    } catch (error) {
      reminderStatus.textContent = liteT('lite.reminders.failed', { error: String(error) });
    }
  }

  function standSummary(minutes: number) {
    return standReminder.checked ? liteT('lite.reminder.on', { n: minutes }) : liteT('lite.reminder.off');
  }

  /**
   * Point the language chips at `preference`: the CSS thumb slides to that slot
   * and the pressed state follows. Called on every paint too, so a config coming
   * back from elsewhere lands on the same chip.
   */
  function paintLanguage(preference: LocalePreference) {
    const index = Math.max(0, LOCALE_ORDER.indexOf(preference));
    language.style.setProperty('--lang-index', String(index));
    for (const button of languageButtons) {
      button.setAttribute('aria-pressed', button.dataset.locale === preference ? 'true' : 'false');
    }
  }

  function paint(cfg: AppConfig) {
    // A language switch replaces the dictionary asynchronously, so the strings
    // built from it are refreshed by one more paint once it has arrived.
    const localeChanged = !!current && current.locale !== cfg.locale;
    current = cfg;
    paintLanguage(cfg.locale);
    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#skins button'))) {
      button.classList.toggle('active', button.dataset.skin === cfg.skin);
    }
    size.value = String(cfg.petScale || 1);
    opacity.value = String(cfg.opacity || 1);
    $<HTMLOutputElement>('size-value').textContent = `${Math.round(Number(size.value) * 100)}%`;
    $<HTMLOutputElement>('opacity-value').textContent = `${Math.round(Number(opacity.value) * 100)}%`;
    autoMove.checked = !!cfg.autoMove;
    snapToEdge.checked = cfg.snapToEdge === true;
    customOutline.checked = cfg.customOutline === true;
    fileDropReactions.checked = cfg.fileDropReactions !== false;
    const minutes = reminderMinutes(cfg);
    standReminder.checked = cfg.standReminderEnabled !== false;
    standInterval.value = [5, 10, 20, 30].includes(minutes) ? String(minutes) : 'custom';
    standCustom.value = String(minutes);
    standCustomLabel.hidden = standInterval.value !== 'custom';
    standStatus.textContent = standSummary(minutes);
    hourlyChime.checked = cfg.hourlyChime !== false;
    loadAwareness.checked = cfg.loadAwareness !== false;
    paintAffinity(cfg);
    // The treat buttons carry translated names, so they follow the *loaded*
    // dictionary rather than config.locale: the switch to a new dictionary is
    // asynchronous, and building them from the language picker would label them
    // in the previous language until the next unrelated repaint.
    if (careLocale !== liteCurrentLocale()) {
      careLocale = liteCurrentLocale();
      buildCareFoods();
    }
    paintCare(cfg);
    paintHealth(cfg);
    paintHeatmap(cfg);
    paintSummary(cfg);
    paintReport(cfg);
    // The pack cards are translated markup, so a language switch rebuilds them;
    // otherwise only the "in use" outline can have changed.
    if (packsLocale !== liteCurrentLocale()) buildPacks(); else paintPackSelection(cfg);
    paintReminders(cfg);
    updateAutoCheck.checked = cfg.updateAutoCheck !== false;
    updateAutoDownload.checked = cfg.updateAutoDownload !== false;
    // The status line is built from the dictionary, so it is refreshed on every
    // paint — including the one that follows a language switch.
    if (lastUpdate) renderUpdate(lastUpdate);
    if (localeChanged) {
      // Any half-finished status line is in the previous language; drop it.
      message('');
      void liteLoadDictionary()
        .then(() => paint(current as AppConfig))
        .catch(error => console.error('[lite-settings] i18n:', error));
    }
  }

  function saveStandReminder() {
    standCustomLabel.hidden = standInterval.value !== 'custom';
    const minutes = standInterval.value === 'custom' ? Number(standCustom.value) : Number(standInterval.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      standStatus.textContent = liteT('lite.reminder.invalid');
      return;
    }
    standStatus.textContent = standSummary(minutes);
    void window.api.setConfig({ standReminderEnabled: standReminder.checked, standReminderMinutes: minutes })
      .catch(error => { standStatus.textContent = liteT('lite.reminder.failed', { error: String(error) }); });
  }

  $<HTMLButtonElement>('close').addEventListener('click', () => window.api.closeSettings());
  // The title bar's GitHub button: the address lives in the Rust side, so this
  // only has to say "open it".
  $<HTMLButtonElement>('open-github').addEventListener('click', () => window.api.openProjectPage());
  // The star invitation in the title bar is the same link, worded as a favour.
  $<HTMLButtonElement>('star-invite').addEventListener('click', () => window.api.openProjectPage());
  $<HTMLButtonElement>('choose-image').addEventListener('click', () => void chooseImage());
  $<HTMLButtonElement>('cancel-image').addEventListener('click', () => void cancelImage());
  // The mask editor is a separate window; it reports back through the config
  // broadcast, so this panel only has to drop its own preview.
  refine.addEventListener('click', () => window.api.openMaskEditor());
  window.api.onCustomImageChanged(() => {
    candidate = null;
    preview.hidden = true;
    message(liteT('lite.image.applied'));
  });
  confirm.addEventListener('click', () => void confirmImage());
  cutout.addEventListener('change', () => void updatePreview());
  $<HTMLButtonElement>('reset-position').addEventListener('click', () => window.api.resetPosition());
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#skins button'))) {
    button.addEventListener('click', async () => {
      const skin = button.dataset.skin as PetSkin;
      if (skin === 'custom') {
        const image = await window.api.getCustomImage();
        if (!image.ok) { await chooseImage(); return; }
      }
      await window.api.setConfig({ skin, currentPetId: skin });
    });
  }
  newPack.addEventListener('click', () => { packStatus.classList.remove('error'); packStatus.textContent = ''; openEditor(''); });
  importPack.addEventListener('click', async () => {
    packStatus.classList.remove('error');
    try {
      const result = await window.api.petImport();
      if (result.cancelled) return;
      if (!result.ok) {
        packStatus.classList.add('error');
        packStatus.textContent = liteT('lite.pack.importFailed', { error: result.error ?? '' });
        return;
      }
      await refreshPacks();
      packStatus.textContent = liteT('lite.pack.imported', { name: result.pet?.displayName ?? result.pet?.id ?? '' });
    } catch (error) {
      packStatus.classList.add('error');
      packStatus.textContent = liteT('lite.pack.importFailed', { error: String(error) });
    }
  });
  packs.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pack-action]');
    const id = button?.closest<HTMLElement>('[data-pack-id]')?.dataset.packId;
    if (!button || !id) return;
    const action = button.dataset.packAction;
    if (action === 'use') { await window.api.setConfig({ skin: 'pack', currentPetId: id }); return; }
    if (action === 'edit') { openEditor(id); return; }
    packStatus.classList.remove('error');
    try {
      if (action === 'export') {
        const result = await window.api.petExport(id);
        if (result.cancelled) return;
        if (!result.ok) {
          packStatus.classList.add('error');
          packStatus.textContent = liteT('lite.pack.exportFailed', { error: result.error ?? '' });
          return;
        }
        packStatus.textContent = liteT('lite.pack.exported', { path: result.path ?? '' });
        return;
      }
      const removed = pets.find(pet => pet.id === id);
      const result = await window.api.petRemove(id);
      if (!result.ok) {
        packStatus.classList.add('error');
        packStatus.textContent = liteT('lite.pack.removeFailed', { error: result.error ?? '' });
        return;
      }
      // The backend put the pet back on Bulu when it was wearing the deleted pack,
      // and broadcasts the new config — this only refreshes the list.
      await refreshPacks();
      packStatus.textContent = liteT('lite.pack.removed', { name: removed?.displayName ?? id });
    } catch (error) {
      packStatus.classList.add('error');
      packStatus.textContent = liteT('lite.pack.removeFailed', { error: String(error) });
    }
  });
  size.addEventListener('input', () => { $<HTMLOutputElement>('size-value').textContent = `${Math.round(Number(size.value) * 100)}%`; });
  size.addEventListener('change', () => void window.api.setConfig({ petScale: Number(size.value) }));
  opacity.addEventListener('input', () => { $<HTMLOutputElement>('opacity-value').textContent = `${Math.round(Number(opacity.value) * 100)}%`; });
  opacity.addEventListener('change', () => void window.api.setConfig({ opacity: Number(opacity.value) }));
  // The thumb starts moving on the click itself; the new dictionary arrives with
  // the config broadcast, so the slide and the relabelling overlap instead of the
  // control snapping back and forth.
  for (const button of languageButtons) {
    button.addEventListener('click', () => {
      const preference = button.dataset.locale as LocalePreference;
      paintLanguage(preference);
      void window.api.setConfig({ locale: preference });
    });
  }
  autoMove.addEventListener('change', () => void window.api.setConfig({ autoMove: autoMove.checked }));
  snapToEdge.addEventListener('change', () => void window.api.setConfig({ snapToEdge: snapToEdge.checked }));
  customOutline.addEventListener('change', () => void window.api.setConfig({ customOutline: customOutline.checked }));
  fileDropReactions.addEventListener('change', () => void window.api.setConfig({ fileDropReactions: fileDropReactions.checked }));
  standReminder.addEventListener('change', saveStandReminder);
  standInterval.addEventListener('change', () => {
    if (standInterval.value === 'custom') {
      // Selecting Custom only reveals the editor. Saving the old value here
      // broadcasts a config update that paints the preset back over it.
      standCustomLabel.hidden = false;
      standCustom.focus();
      standCustom.select();
      return;
    }
    saveStandReminder();
  });
  standCustom.addEventListener('change', saveStandReminder);
  // The chart shows one whole calendar year; these step it. The forward arrow
  // stops at the current year because the future has nothing to show.
  heatmapPrev.addEventListener('click', () => {
    heatmapYear -= 1;
    if (current) paintHeatmap(current);
  });
  heatmapNext.addEventListener('click', () => {
    heatmapYear += 1;
    if (current) paintHeatmap(current);
  });
  eyeRest.addEventListener('change', saveHealth);
  water.addEventListener('change', saveHealth);
  // Like the standing reminder: choosing "custom" only opens the number field,
  // and the value is written when that field changes. Saving on the select's own
  // change would write the old preset and snap the choice back.
  eyeInterval.addEventListener('change', () => revealCustom(eyeInterval, eyeCustomLabel, eyeCustom));
  waterInterval.addEventListener('change', () => revealCustom(waterInterval, waterCustomLabel, waterCustom));
  eyeCustom.addEventListener('change', saveHealth);
  waterCustom.addEventListener('change', saveHealth);
  hourlyChime.addEventListener('change', () => void window.api.setConfig({ hourlyChime: hourlyChime.checked }));
  loadAwareness.addEventListener('change', () => void window.api.setConfig({ loadAwareness: loadAwareness.checked }));
  reminderAdd.addEventListener('click', () => void addReminder());
  reminderText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void addReminder();
  });
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-reminder-quick]'))) {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.reminderQuick);
      if (!Number.isFinite(minutes)) return;
      reminderTime.value = timeValue(new Date(Date.now() + minutes * 60_000));
    });
  }
  // The pet's right-click "Remind me…" entry opens this window at the section.
  window.api.onSettingsFocusSection((section) => {
    if (section !== 'reminders') return;
    if (!reminderTime.value) reminderTime.value = timeValue(new Date(Date.now() + 10 * 60_000));
    document.getElementById('reminders')?.scrollIntoView({ block: 'center' });
    reminderText.focus();
  });
  checkUpdateButton.addEventListener('click', async () => {
    checkUpdateButton.disabled = true;
    // `true` bypasses the six-hour throttle: this is the user asking now.
    renderUpdate(await window.api.updateCheck(true));
  });
  downloadUpdateButton.addEventListener('click', async () => {
    downloadUpdateButton.hidden = true;
    renderUpdate(await window.api.updateDownload());
  });
  installUpdateButton.addEventListener('click', async () => {
    installUpdateButton.disabled = true;
    try {
      await window.api.updateInstall();
    } catch (error) {
      updateStatus.classList.add('err');
      updateStatus.textContent = String(error);
      installUpdateButton.disabled = false;
    }
  });
  updateAutoCheck.addEventListener('change', () => void window.api.setConfig({ updateAutoCheck: updateAutoCheck.checked }));
  updateAutoDownload.addEventListener('change', () => void window.api.setConfig({ updateAutoDownload: updateAutoDownload.checked }));
  // Diagnostics: bundle the log into a folder the user picks, or open it in place.
  exportDiagnosticsButton.addEventListener('click', async () => {
    exportDiagnosticsButton.disabled = true;
    diagStatus.classList.remove('error');
    try {
      const result = await window.api.exportDiagnostics();
      if (result.cancelled) return;
      if (!result.ok) {
        diagStatus.classList.add('error');
        diagStatus.textContent = liteT('lite.diag.failed', { error: result.error ?? '' });
        return;
      }
      diagStatus.textContent = liteT('lite.diag.exported', { path: result.path ?? '' });
    } catch (error) {
      diagStatus.classList.add('error');
      diagStatus.textContent = liteT('lite.diag.failed', { error: String(error) });
    } finally {
      exportDiagnosticsButton.disabled = false;
    }
  });
  revealLogButton.addEventListener('click', () => window.api.revealLog());
  // Backup: write the data folder to a folder the user picks, or restore one
  // over the current data. Restoring replaces everything, so the backend keeps a
  // copy of what was there first (nothing is asked of the user in advance).
  backupExportButton.addEventListener('click', async () => {
    backupExportButton.disabled = true;
    backupStatus.classList.remove('error');
    try {
      const result = await window.api.backupExport();
      if (result.cancelled) return;
      if (!result.ok) {
        backupStatus.classList.add('error');
        backupStatus.textContent = liteT('lite.backup.failed', { error: result.error ?? '' });
        return;
      }
      backupStatus.textContent = liteT('lite.backup.exported', { path: result.path ?? '' });
    } catch (error) {
      backupStatus.classList.add('error');
      backupStatus.textContent = liteT('lite.backup.failed', { error: String(error) });
    } finally {
      backupExportButton.disabled = false;
    }
  });
  backupImportButton.addEventListener('click', async () => {
    backupImportButton.disabled = true;
    backupStatus.classList.remove('error');
    try {
      const result = await window.api.backupImport();
      if (result.cancelled) return;
      if (!result.ok) {
        backupStatus.classList.add('error');
        backupStatus.textContent = liteT('lite.backup.failed', { error: result.error ?? '' });
        return;
      }
      backupStatus.textContent = liteT('lite.backup.restored', { path: result.path ?? '' });
    } catch (error) {
      backupStatus.classList.add('error');
      backupStatus.textContent = liteT('lite.backup.failed', { error: String(error) });
    } finally {
      backupImportButton.disabled = false;
    }
  });
  window.api.onUpdateState(renderUpdate);
  autoLaunch.addEventListener('change', () => void window.api.autoLaunchSet(autoLaunch.checked).then((enabled) => {
    autoLaunch.checked = enabled;
  }).catch((error) => message(liteT('lite.autoLaunch.failed', { error: String(error) }), true)));

  void (async () => {
    // Translate before the first paint so no key is ever painted on screen.
    await liteLoadDictionary().catch((error) => console.error('[lite-settings] i18n:', error));
    const [cfg, enabled] = await Promise.all([window.api.getConfig(), window.api.autoLaunchGet()]);
    paint(cfg);
    // The stored language is in place now, so later changes may animate.
    language.classList.add('is-live');
    // A sensible starting point for the time box: ten minutes from now.
    reminderTime.value = timeValue(new Date(Date.now() + 10 * 60_000));
    renderUpdate(await window.api.updateGetState());
    autoLaunch.checked = enabled;
    // The pack list is a directory read, not a config value, so it is fetched
    // once here and after every import / delete rather than on every paint.
    await refreshPacks();
    window.api.onConfigChanged(paint);
  })().catch((error) => message(liteT('lite.settings.loadFailed', { error: String(error) }), true));
})();
