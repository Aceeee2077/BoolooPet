/** The lightweight desktop pet: one canvas, five built-in skins, or one photo. */
(() => {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
  const speech = document.getElementById('pet-speech') as HTMLDivElement;
  const hearts = document.getElementById('pet-hearts') as HTMLDivElement;
  const dream = document.getElementById('pet-dream') as HTMLDivElement;
  // The reminder sign and the load badge are optional elements: a harness (or an
  // older page) without them must not take the whole pet loop down.
  const sign = document.getElementById('pet-sign') as HTMLDivElement | undefined;
  const mood = document.getElementById('pet-mood') as HTMLDivElement | undefined;
  const affinityChip = document.getElementById('pet-affinity') as HTMLDivElement | undefined;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Every Mac is Retina and Windows machines frequently sit at 125–150%, while the
  // pet is pixel art: the backing store has to match the device pixels or the
  // compositor stretches it into a blur. All drawing stays in 300x300 CSS units;
  // only the bitmap and the base transform scale.
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(300 * dpr);
  canvas.height = Math.round(300 * dpr);
  ctx.scale(dpr, dpr);

  /** Dragging the pet onto a display with another scale changes the ratio live. */
  function syncPixelRatio() {
    const next = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (next === dpr) return;
    dpr = next;
    // Assigning the bitmap size resets the context, so the transform is reapplied.
    canvas.width = Math.round(300 * next);
    canvas.height = Math.round(300 * next);
    ctx.scale(next, next);
  }

  // Bulu is the only built-in character; anything else on screen is the user's
  // own imported picture (see `loadCustom`).
  const sources: Record<string, string> = { bulu: '../assets/animated-pets/bulu.png' };
  const sheets: Record<string, HTMLImageElement> = {};
  for (const [skin, url] of Object.entries(sources)) {
    const image = new Image(); image.src = url; sheets[skin] = image;
  }
  const buluActions = new Image();
  buluActions.src = '../assets/animated-pets/bulu-actions.webp';
  /**
   * Bulu in the air: four poses built from the walking art by
   * `scripts/build-bulu-airborne.mjs`, so a thrown pet flails instead of walking.
   * Its own file, which is what keeps the walking animation untouched.
   */
  const buluAirborne = new Image();
  buluAirborne.src = '../assets/animated-pets/bulu-airborne.png';
// Row order must match ACTIONS in scripts/build-bulu-art.mjs.
type PetAction = 'wave' | 'groom' | 'stretch' | 'yawn' | 'scratch';
/** Which half of the pet a pointer landed on: the head, or everything below it. */
type PetRegion = 'head' | 'body';
const actionRows: Record<PetAction, number> = { wave: 0, groom: 1, stretch: 2, yawn: 3, scratch: 4 };
/** Each atlas row is one action's whole sheet: 4x4 source frames in a row. */
const ACTION_FRAMES = 16;
/** One frame of the airborne wriggle stays on screen this long. */
const AIRBORNE_FRAME_MS = 70;
/**
 * The airborne strip is generated 9% small so a rotated pose still fits its cell
 * (`FIT_SCALE_FROM` in scripts/build-bulu-airborne.mjs). Drawing it that much
 * larger keeps the pet the same size on screen whether it is walking or flying.
 */
const AIRBORNE_DRAW_SCALE = 1 / 0.91;
/**
 * Bulu's blink. The idle row's last cell is a closed-eye pose baked into
 * bulu.png by scripts/build-bulu-blink.mjs; the pet holds it for BLINK_MS and
 * then waits BLINK_GAP +/- jitter before the next one, so the resting pose
 * breathes without turning into a twitch.
 */
const BLINK_COLUMN = 3;
const BLINK_MS = 150;
const BLINK_GAP_MS = 3200;
const BLINK_JITTER_MS = 5200;
// The walking gait (frame length, body bob, ground covered per stride) lives in
// lite-gait.ts, so the legs, the body and the window movement all read one clock.
/**
 * Directions the sticker outline is stamped in. Diagonals are in the list so a
 * rounded silhouette has no gap at the corners.
 */
const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> =
  [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  let activeAction: { kind: PetAction; started: number; duration: number } | null = null;
  let config: AppConfig | null = null;
  let custom: LitePreparedImage | null = null;
  /** White silhouette of `custom`, drawn under it when the outline is on. */
  let customOutline: HTMLCanvasElement | null = null;
  /** The installed pet pack the config points at, once its sheet has decoded. */
  let pack: { entry: LitePetPackEntry; sheet: HTMLImageElement } | null = null;
  /**
   * Which of the pack's animations is playing, and when it started.
   *
   * A pack's frames come from its own `fps`, so the clock restarts whenever the
   * animation changes — otherwise switching from idle to walk would drop the pet
   * into the middle of the walk cycle.
   */
  let packAnimation = '';
  let packAnimationStartedAt = 0;
  let loadSerial = 0;
  let facing: -1 | 1 = 1;
  let dragging = false;
  let pressed = false;
  let pressAt = { x: 0, y: 0 };
  let lastDragScreenX = 0;
  let nextSleep = performance.now() + 90_000;
  let sleepUntil = 0;
  let walkUntil = 0;
  /**
   * When the current walk started, or 0 when the pet is not walking.
   *
   * The gait is measured from here instead of from the wall clock, so a walk
   * always begins on frame 0 and the body bob is in phase with the legs from the
   * first step. Cleared as soon as the pet leaves the walking state (see `draw`).
   */
  let gaitStartedAt = 0;
  /**
   * The pet's flight after a throw, or null when it is not airborne.
   *
   * `bounds` is the work-area box Rust computed for this throw (see
   * src/renderer/lite-throw.ts); the loop integrates it in `stepFlight`.
   */
  let flight: { x: number; y: number; vx: number; vy: number; at: number; bounds: ThrowBounds } | null = null;
  /** The tail of the drag, sampled in screen px + ms, for the release velocity. */
  const dragSamples: ThrowSample[] = [];
  let nextWalk = performance.now() + 5000;
  let clickUntil = 0;
  let speechTimer: number | null = null;
  let heartsTimer: number | null = null;
  let nextReminderAt = 0;
  let nextHourAt = 0;
  let nextDreamAt = 0;
  let dreamUntil = 0;
  let dreamIndex = 0;
  let reminderRunning = false;
  let reminderRunId = 0;
  let pettingDistance = 0;
  let pettingTurns = 0;
  let pettingDirection = 0;
  let pettingLastX: number | null = null;
  let pettingLastAt = 0;
  let pettingCooldownUntil = 0;
  /** Which half of the pet the current stroke started on (head vs body). */
  let pettingRegion: PetRegion | null = null;
  /** Where the pointer went down, so a tap can be answered from its own region. */
  let pressRegion: PetRegion = 'body';
  let pressStartedAt = 0;
  let longPressFired = false;
  let lastTapAt = 0;
  let nextBlinkAt = 0;
  let blinkUntil = 0;
  let signTimer: number | null = null;
  /** Reminder ids already handed to the sign; the config update lands a tick later. */
  const handledReminders = new Set<string>();
  let load: SystemLoad | null = null;
  /** Consecutive polls above the "busy" threshold — one hot reading is noise. */
  let hotPolls = 0;
  /** -Infinity, not 0: the first hot streak has to be announced too. */
  let lastTiredAt = Number.NEGATIVE_INFINITY;
  let lowBatteryAnnounced = false;
  let wasCharging: boolean | null = null;
  let moodIcon = '';
  let moodUntil = 0;
  /** Health plan: when the look-away / drink-water nudges are next due. */
  let nextEyeRestAt = 0;
  let nextWaterAt = 0;
  /**
   * Daily counters that have not been written to the config yet. Clicking is
   * cheap and frequent, so the write is batched (see `flushDailyStats`) instead
   * of rewriting the config file on every tap.
   */
  const pendingStats: Record<string, DailyStat> = {};
  let statsFlushAt = 0;
  /** Days with a real interaction, pending merge into `statsDays`. */
  const daysToAdd = new Set<string>();
  /**
   * The achievement shelf this window owns. It is seeded from the config once,
   * then updated locally so a badge can be celebrated the moment it lands rather
   * than a config write later; `flushStats` writes the whole shelf with the rest
   * of the buffered counters.
   */
  let achievements: AchievementState = { unlocked: {}, counters: {} };
  let achievementsSeeded = false;
  let achievementsDirty = false;
  /** Achievement lines waiting for the pet to finish its current sentence. */
  const achievementQueue: string[] = [];
  let achievementQueueTimer: number | null = null;
  /**
   * The score and the lifetime click count the pet owns.
   *
   * They are kept here rather than re-read from the config on every award: a
   * write is batched, so the config the pet holds is briefly behind what it has
   * already handed out. `applyConfig` only ever raises these (an older config
   * cannot take points away), which keeps a late broadcast from losing any.
   */
  let affinityTotal = -1;
  let clicksTotal = -1;
  let affinityChipTimer: number | null = null;
  /**
   * When the pet last said something about affinity. A tap awards points *and*
   * answers the poke, and the poke line would otherwise land on top of a level-up
   * (or the once-a-day hello) that the same tap just triggered.
   */
  let affinitySpokeAt = 0;
  let lastEdgePoll = 0;
  let visibleRect: PetBox = { x: 86, y: 140, w: 128, h: 150 };
  let lastHover = false;
  // Feeding and the cat teaser (see lite-care.ts for the model). The tray is
  // open or it is not, at most one treat is being eaten at a time, and the toy
  // session carries its own clock so a pounce can be interrupted cleanly.
  let tray: CareTray | null = null;
  let eating: CareEating | null = null;
  let toy: CareToySession | null = null;
  /** The pet's needs, mirrored into `config.petStats`. */
  let needs: CareNeeds = { ...CARE_NEEDS_DEFAULT };
  /** Seeded once, from the first config the window sees: a later broadcast carries
   *  the value this window itself just wrote, and reading it back would undo the
   *  drift that happened in between. */
  let needsSeeded = false;
  let needsDirty = false;
  /** `performance.now()` of the last whole minute of hunger drift. */
  let hungerAt = 0;
  /** Wall clock of the last "I am hungry" line, so it cannot nag. */
  let lastHungryAt = Number.NEGATIVE_INFINITY;
  (window as unknown as Record<string, unknown>).__boolooLiteState = () => ({
    skin: config?.skin ?? null,
    customReady: !!custom,
    bounds: visibleRect,
    action: activeAction?.kind ?? null,
    // The care loop: hunger (0 = full, 100 = starving) and what is on screen.
    hunger: needs.hunger,
    care: tray ? 'tray' : eating ? 'eating' : toy ? 'toy' : null,
    // The self-check reads these to prove the affinity model is live in a real
    // window: the score is a number and the level is one of the five.
    affinity: affinityTotal >= 0 ? affinityTotal : Number(config?.affinity) || 0,
    affinityLevel: affinityLevel(affinityTotal >= 0 ? affinityTotal : Number(config?.affinity) || 0),
  });

  function stopWalking() {
    if (!walkUntil) return;
    walkUntil = 0;
    window.api.autoMoveStop();
    nextWalk = performance.now() + 4000 + Math.random() * 6000;
  }

  // ---------- the throw ----------
  /**
   * Remember one pointer position from the drag.
   *
   * The buffer's policy (how much of the gesture to keep) lives with the model, in
   * `throwRemember` — it is bounded by *time*, because a fixed sample count is a
   * different amount of gesture on a 125 Hz mouse than on a 1000 Hz one.
   */
  function sampleDrag(x: number, y: number) {
    throwRemember(dragSamples, x, y, performance.now());
  }

  /**
   * Turn the gesture that just ended into a flight.
   *
   * The launch position is read back from the window instead of assumed: while the
   * button was down Rust owned the cursor anchor (`drag_begin` / `drag_move`), so
   * the real position is the only trustworthy answer. A grab that happened while
   * these awaits were in flight wins — catching a thrown pet must not fight with
   * the throw that was already starting.
   *
   * `velocity` comes from the caller because the same judgement decides whether the
   * drop may dock the pet to a screen edge: a flick must not be nudged first, or the
   * flight would launch from somewhere the cursor never was.
   */
  async function launchThrow(velocity: ThrowVelocity | null) {
    dragSamples.length = 0;
    if (!velocity) return;
    try {
      const [x, y] = await window.api.getWindowPosition();
      if (pressed || dragging) return;
      // Rust owns the edges: this needs the work area, the monitor scale factor and
      // the pet's silhouette, none of which the page can see. No box = no flight.
      const bounds = throwBounds(await window.api.flightBounds(visibleRect));
      if (!bounds) return;
      flight = { x, y, vx: velocity.vx, vy: velocity.vy, at: performance.now(), bounds };
      // Wakes the pet and stops any walk that was still running, so nothing else
      // moves the window while the flight owns it.
      activity();
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `throw: ${String(error)}`;
    }
  }

  /**
   * One tick of the flight, then the window move that follows it.
   *
   * The move is fire-and-forget: `window_move_to` clamps to the monitor on the
   * Rust side anyway, and awaiting an IPC round trip per frame would put the whole
   * pet loop behind the animation frame it is drawing.
   *
   * Every frame of the flight — the landing one included — uses the plain move, so a
   * flick is never pulled onto a screen edge: the throw ends exactly where friction,
   * gravity and the bounce left it.
   */
  function stepFlight(now: number) {
    if (!flight) return;
    const next = throwStep(flight, now - flight.at, flight.bounds);
    flight = next.settled ? null : { ...flight, x: next.x, y: next.y, vx: next.vx, vy: next.vy, at: now };
    window.api.moveWindowTo(next.x, next.y);
  }

  /**
   * Lean the pet into its travel while it is in the air.
   *
   * Cosmetic — the position is what the throw is about — but without it a thrown pet
   * reads as a window that jumped. The sign is flipped when the art is mirrored, so
   * the pet leans the same way on screen as it does in the unmirrored canvas.
   */
  function leanForFlight(state: string, centerX: number, centerY: number, mirrored: boolean) {
    if (state !== 'thrown' || !flight) return;
    ctx.translate(centerX, centerY);
    ctx.rotate(throwTilt(flight.vx) * (mirrored ? -1 : 1));
    ctx.translate(-centerX, -centerY);
  }

  function activity() {
    activeAction = null;
    nextSleep = performance.now() + 90_000;
    sleepUntil = 0;
    dream.hidden = true;
    nextDreamAt = 0;
    dreamUntil = 0;
    hideSign();
    if (walkUntil) stopWalking();
    // A treat that is halfway down the throat still counts: the needs were
    // consumed when it was picked, so the animation is only dropped here.
    if (eating) finishEating(true);
    if (tray) tray = null;
    // The caller is about to set `activeAction`: the pose has to start now, not at
    // the next backstop, or a pet that was asleep would answer the touch late.
    scheduleFrame();
  }

  function say(line: string, duration = 3600) {
    if (speechTimer !== null) window.clearTimeout(speechTimer);
    speech.textContent = line;
    speech.hidden = false;
    speechTimer = window.setTimeout(() => { speech.hidden = true; speechTimer = null; }, duration);
  }

  // ---------- the reminder sign ----------
  // A reminder is announced with a card above the pet rather than a speech
  // bubble: it holds a whole sentence, and it stays up until the user
  // acknowledges it by touching the pet (or after SIGN_HOLD_MS).
  const SIGN_HOLD_MS = 25_000;

  function hideSign() {
    if (signTimer !== null) { window.clearTimeout(signTimer); signTimer = null; }
    if (sign && !sign.hidden) sign.hidden = true;
  }

  function showSign(text: string) {
    // Without the element (a trimmed page) the line still has to reach the user.
    if (!sign) { say(liteT('lite.pet.reminder', { text }), 8000); return; }
    speech.hidden = true;
    sign.textContent = liteT('lite.pet.reminder', { text });
    sign.hidden = false;
    if (signTimer !== null) window.clearTimeout(signTimer);
    signTimer = window.setTimeout(() => { sign.hidden = true; signTimer = null; }, SIGN_HOLD_MS);
  }

  // ---------- where on the pet a pointer landed ----------
  // The head band is the same one the original petting check used: the body
  // starts slightly before the halfway line so a stroke that drifts across the
  // boundary keeps counting as one stroke rather than restarting.
  const HEAD_BOTTOM = 0.55;
  const BODY_TOP = 0.45;

  function regionAt(x: number, y: number): PetRegion | null {
    if (!hit(x, y)) return null;
    if (x < visibleRect.x + visibleRect.w * 0.1 || x > visibleRect.x + visibleRect.w * 0.9) {
      // The edges are tail / whiskers: touchable, but not strokeable.
      return y <= visibleRect.y + visibleRect.h * HEAD_BOTTOM ? null : 'body';
    }
    if (y <= visibleRect.y + visibleRect.h * HEAD_BOTTOM) return 'head';
    return y >= visibleRect.y + visibleRect.h * BODY_TOP ? 'body' : null;
  }

  function showHearts() {
    hearts.style.left = `${Math.min(245, visibleRect.x + visibleRect.w * 0.67)}px`;
    hearts.style.top = `${Math.max(35, visibleRect.y)}px`;
    hearts.hidden = false;
    hearts.style.animation = 'none';
    void hearts.offsetWidth;
    hearts.style.animation = '';
    if (heartsTimer !== null) window.clearTimeout(heartsTimer);
    heartsTimer = window.setTimeout(() => { hearts.hidden = true; heartsTimer = null; }, 1300);
  }

  // ---------- blinking ----------
  /**
   * Which idle column to draw. Only the resting pose blinks: while the pet
   * walks, sleeps or plays an action its eyes are part of that pose, and a blink
   * is scheduled from wherever it settles down again instead of piling up.
   */
  function blinkColumn(now: number, state: string, acting: boolean): number {
    const resting = state === 'idle' && !acting;
    if (!resting) {
      if (nextBlinkAt < now) nextBlinkAt = now + 1500;
      return 0;
    }
    if (!nextBlinkAt) nextBlinkAt = now + 2200 + Math.random() * 1800;
    if (now >= nextBlinkAt) {
      blinkUntil = now + BLINK_MS;
      nextBlinkAt = now + BLINK_GAP_MS + Math.random() * BLINK_JITTER_MS;
    }
    return now < blinkUntil ? BLINK_COLUMN : 0;
  }

  // ---------- software updates ----------
  // The pet is the messenger; the check itself and the buttons live in
  // src-tauri/src/updater.rs and the settings panel. Only status *changes* are
  // announced — a download emits a progress event per chunk.
  let announcedUpdate: UpdateState['status'] | null = null;

  function announceUpdate(state: UpdateState) {
    if (state.status === announcedUpdate) return;
    announcedUpdate = state.status;
    const version = state.version ?? '';
    if (state.status === 'available' && version) {
      const key = state.autoDownload ? 'update.available' : 'update.availableManual';
      say(liteT(key, { v: version }), 5200);
    } else if (state.status === 'downloaded' && version) {
      say(liteT('update.downloadedNotice', { v: version }), 5200);
    }
  }

  async function checkForUpdates() {
    try {
      const state = await window.api.updateCheck();
      announceUpdate(state);
      // Auto-download follows the check, so the pet can hand over the "ready"
      // notice instead of making the user press a second button. A stale result
      // means the network is down — downloading it would only fail loudly.
      if (state.status === 'available' && state.autoDownload && !state.stale) {
        announceUpdate(await window.api.updateDownload());
      }
    } catch (error) {
      // Offline or rate-limited: stay quiet, the settings panel can retry.
      console.error('[lite-app] update check:', error);
    }
  }

  function playAction(name: string) {
    if (!config || pressed || dragging || reminderRunning || !(name in actionRows)) return;
    const kind = name as PetAction;
    activity();
    clickUntil = 0;
    speech.hidden = true;
    activeAction = { kind, started: performance.now(), duration: kind === 'stretch' ? 2500 : 2100 };
  }

  function resetPetting() {
    pettingDistance = 0;
    pettingTurns = 0;
    pettingDirection = 0;
    pettingLastX = null;
    pettingRegion = null;
  }

  /**
   * A back-and-forth stroke over the pet. The head and the body answer
   * differently — a stroked head just melts, a stroked back makes the pet settle
   * down and groom itself — so the straight-line distance and the number of
   * direction changes are tracked per region.
   */
  function petStrokeMove(x: number, y: number, buttons: number) {
    const now = performance.now();
    const region = buttons || pressed || dragging || reminderRunning || tray || now < pettingCooldownUntil
      ? null
      : regionAt(x, y);
    if (!region) {
      resetPetting();
      return;
    }
    // Crossing from the head to the back restarts the count instead of adding a
    // second, unrelated stroke to the first one.
    if (pettingRegion && pettingRegion !== region) resetPetting();
    pettingRegion = region;
    if (now - pettingLastAt > 900) resetPetting();
    if (pettingLastX !== null) {
      const dx = x - pettingLastX;
      if (Math.abs(dx) >= 2 && Math.abs(dx) <= 40) {
        const direction = Math.sign(dx);
        if (pettingDirection && direction !== pettingDirection && pettingDistance >= 12) pettingTurns++;
        pettingDirection = direction;
        pettingDistance += Math.abs(dx);
      }
    }
    pettingLastX = x;
    pettingLastAt = now;
    if (pettingDistance < 55 || pettingTurns < 1) return;
    const stroked = region;
    resetPetting();
    pettingCooldownUntil = now + 3200;
    activity();
    clickUntil = now + 900;
    showHearts();
    markActiveDay();
    awardAffinity(stroked === 'head' ? 'petHead' : 'petBody');
    if (stroked === 'head') {
      say(liteT('lite.pet.petting'), 2000);
    } else {
      // A groomed back reads as "that was good": the pet answers by grooming.
      playAction('groom');
      // After the action, because starting one clears whatever bubble was up.
      say(liteT('lite.pet.purring'), 2200);
    }
    bumpAchievement('pets');
    settleAchievements();
  }

  /**
   * Run the pet to the middle of its screen. Shared by the standing reminder and
   * the user's own reminders — both need the pet to come over and be noticed.
   * A press or a new call cancels it mid-flight; the result says whether this run
   * was the one that arrived.
   */
  async function walkToCenter(): Promise<boolean> {
    const runId = ++reminderRunId;
    try {
      const [start, target] = await Promise.all([
        window.api.getWindowPosition(), window.api.getWindowCenterTarget(visibleRect),
      ]);
      if (runId !== reminderRunId) return false;
      facing = target[0] < start[0] ? -1 : 1;
      const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
      const duration = Math.max(450, Math.min(2600, distance / 550 * 1000));
      const began = performance.now();
      while (runId === reminderRunId && !pressed && !dragging) {
        const fraction = Math.min(1, (performance.now() - began) / duration);
        const eased = 1 - (1 - fraction) ** 2;
        await window.api.moveWindowTo(
          start[0] + (target[0] - start[0]) * eased,
          start[1] + (target[1] - start[1]) * eased,
        );
        if (fraction >= 1) break;
        await new Promise(resolve => window.setTimeout(resolve, 32));
      }
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `walk to center: ${String(error)}`;
      if (runId === reminderRunId) window.api.resetPosition();
    }
    return runId === reminderRunId;
  }

  async function runStandReminder() {
    if (reminderRunning || pressed || dragging || config?.standReminderEnabled === false) return;
    reminderRunning = true;
    clickUntil = 0;
    activity();
    let arrived = false;
    try {
      arrived = await walkToCenter();
    } finally {
      reminderRunning = false;
      // Being picked up cancels the walk, and the newer interaction owns the
      // bubble: saying "stand up" to someone holding the pet reads as a bug.
      if (!arrived) return;
      clickUntil = performance.now() + 1100;
      say(liteT('lite.pet.standReminder'), 6500);
      bumpDaily('stand', true);
      bumpAchievement('healths');
      settleAchievements();
    }
  }

  /** Bring the pet over and hold up the reminder until the user touches it. */
  async function runReminder(text: string) {
    if (reminderRunning) return;
    reminderRunning = true;
    clickUntil = 0;
    activity();
    try {
      await walkToCenter();
    } finally {
      reminderRunning = false;
      clickUntil = performance.now() + 900;
      // Shown even when the walk was interrupted: the reminder has already been
      // taken out of the config, and touching the pet is how it is acknowledged.
      showSign(text);
    }
  }

  function checkStandReminder() {
    if (!config || config.standReminderEnabled === false || !nextReminderAt || Date.now() < nextReminderAt) return;
    if (pressed || dragging || reminderRunning) return;
    const minutes = Math.max(1, Math.min(240, Number(config.standReminderMinutes) || 5));
    nextReminderAt = Date.now() + minutes * 60_000;
    void runStandReminder();
  }

  function checkHourlyChime() {
    if (!config || config.hourlyChime === false || !nextHourAt) return;
    const now = Date.now();
    if (now < nextHourAt) return;
    const overdue = now - nextHourAt;
    nextHourAt = litePetNextLocalHour(now);
    if (overdue > 60_000 || pressed || dragging || reminderRunning) return;
    activity();
    clickUntil = performance.now() + 650;
    say(liteT('lite.pet.hourlyChime', { h: new Date(now).getHours() }), 3200);
  }

  // ---------- the user's own reminders ----------
  // A reminder that came due while the machine was asleep is dropped the same way
  // a missed hourly chime is: nobody wants yesterday's "take the cake out" now.
  const REMINDER_GRACE_MS = 10 * 60_000;

  // ---------- daily counters ----------
  // Clicks and health-plan completions, bucketed by local calendar day (see
  // lite-day.ts). The heatmap in Settings reads the very same buckets.
  const STATS_FLUSH_MS = 5000;
  /** More than the heatmap draws; older days are dropped so the config stays small. */
  const STATS_KEEP_DAYS = 400;
  /** How many days of affinity growth the history keeps (one point per day). */
  const AFFINITY_HISTORY_DAYS = 180;
  /** What each kind of interaction is worth. See lite-affinity.ts for the levels. */
  const AFFINITY_GAINS = { tap: 1, doubleTap: 2, petHead: 2, petBody: 3, fileDrop: 2, feed: 2, play: 1 } as const;

  /**
   * Count something for today.
   *
   * The day is looked up on every call rather than remembered, so a running pet
   * crosses midnight into a fresh bucket on its own — no timer, no date sync.
   */
  function bumpDaily(kind: keyof DailyStat, flushNow = false) {
    const day = liteDayKey();
    const entry = pendingStats[day] ?? (pendingStats[day] = {});
    entry[kind] = (Number(entry[kind]) || 0) + 1;
    const at = performance.now() + (flushNow ? 0 : STATS_FLUSH_MS);
    statsFlushAt = statsFlushAt ? Math.min(statsFlushAt, at) : at;
  }

  // ---------- achievements ----------
  /** Lower the next config write, and keep it on the same batching clock. */
  function markAchievementsDirty() {
    achievementsDirty = true;
    const at = performance.now() + STATS_FLUSH_MS;
    statsFlushAt = statsFlushAt ? Math.min(statsFlushAt, at) : at;
  }

  /** Raise one lifetime achievement counter (see AchievementCounter). */
  function bumpAchievement(counter: AchievementCounter, by = 1) {
    if (!config) return;
    achievements = achievementStateWithCounter(achievements, counter, by);
    markAchievementsDirty();
  }

  /**
   * The live context for an achievement check.
   *
   * The config trails this window by one batch, so the buffered clicks, the
   * score already handed out and the days added since the last write are folded
   * in here. Otherwise the hundredth click would not light its badge until the
   * next five-second flush.
   */
  function achievementNow(): AchievementContext {
    const cfg = config as AppConfig;
    const today = liteDayKey();
    const context = achievementContext(cfg, {
      clicks: clicksTotal >= 0 ? clicksTotal : Number(cfg.statsClicks) || 0,
      affinity: affinityTotal >= 0 ? affinityTotal : Number(cfg.affinity) || 0,
      days: new Set([...(cfg.statsDays ?? []), ...daysToAdd]).size,
      counters: achievements.counters,
    });
    const todayClicks = (Number(cfg.dailyStats?.[today]?.clicks) || 0) +
      (Number(pendingStats[today]?.clicks) || 0);
    context.bestDayClicks = Math.max(context.bestDayClicks, todayClicks);
    return context;
  }

  /**
   * Award every badge whose target is now met.
   *
   * Only the locked → unlocked edge is celebrated. `initial` is the one read at
   * startup: an existing user can meet a dozen thresholds retroactively, and
   * stacking a dozen speech bubbles would bury the pet under its own trophies —
   * one summary line is enough. Returns the ids earned, for tests and callers
   * that want to know.
   */
  /**
   * Announce a badge without stealing the line of the interaction that just
   * happened ("好舒服呀～" matters more than the trophy it earned). If the pet
   * is busy talking, the badge waits for the bubble to clear.
   */
  function announceAchievement(line: string) {
    if (speech.hidden && !signVisible()) {
      say(line, 5600);
      return;
    }
    achievementQueue.push(line);
    if (achievementQueueTimer !== null) return;
    const flush = () => {
      achievementQueueTimer = null;
      if (!achievementQueue.length) return;
      if (!speech.hidden || signVisible()) {
        achievementQueueTimer = window.setTimeout(flush, 1400);
        return;
      }
      say(achievementQueue.shift() as string, 5200);
      if (achievementQueue.length) achievementQueueTimer = window.setTimeout(flush, 1600);
    };
    achievementQueueTimer = window.setTimeout(flush, 1400);
  }

  function settleAchievements(initial = false): string[] {
    if (!config) return [];
    const fresh = achievementFresh(config, achievementNow(), achievements);
    if (!fresh.length) return [];
    achievements = achievementStateWithUnlocks(achievements, fresh.map(item => item.id), liteDayKey());
    markAchievementsDirty();
    if (initial) {
      // After the window has settled, and only if nothing else is speaking.
      window.setTimeout(() => {
        if (config) announceAchievement(liteT('lite.achievements.caughtUp', { n: fresh.length }));
      }, 3200);
    } else {
      showHearts();
      announceAchievement(fresh.length === 1
        ? liteT('lite.achievements.unlocked', { name: liteT(fresh[0].nameKey) })
        : liteT('lite.achievements.unlockedMany', { n: fresh.length }));
    }
    return fresh.map(item => item.id);
  }

  /** Night-owl and early-bird badges are about when the tap happened. */
  function noteTapMoment() {
    const hour = new Date().getHours();
    if (hour < 5) bumpAchievement('nightTaps');
    else if (hour < 7) bumpAchievement('earlyTaps');
  }

  function showAffinityChip(gain: number) {
    if (!affinityChip) return;
    affinityChip.textContent = `+${gain} ❤️`;
    affinityChip.style.left = `${Math.min(232, visibleRect.x + visibleRect.w * 0.62)}px`;
    affinityChip.style.top = `${Math.max(18, visibleRect.y - 16)}px`;
    affinityChip.hidden = false;
    affinityChip.style.animation = 'none';
    void affinityChip.offsetWidth;
    affinityChip.style.animation = '';
    if (affinityChipTimer !== null) window.clearTimeout(affinityChipTimer);
    affinityChipTimer = window.setTimeout(() => { affinityChip.hidden = true; affinityChipTimer = null; }, 1100);
  }

  /**
   * Award affinity for touching the pet.
   *
   * The daily cap is the interesting part: the room left is measured against what
   * the config already holds *plus* what is still buffered, so a burst of clicks
   * inside one write window cannot slip past it. The first interaction of a day
   * pays extra and says so; crossing a level is the only other thing worth a
   * bubble, and everything else is just the small floating chip.
   */
  function awardAffinity(reason: keyof typeof AFFINITY_GAINS | 'firstHello', amount?: number) {
    if (!config) return 0;
    const today = liteDayKey();
    const earned = (Number(config.dailyStats?.[today]?.affinity) || 0) +
      (Number(pendingStats[today]?.affinity) || 0);
    // `amount` is how the care loop pays per treat rather than per interaction
    // kind: a can of food is worth more than a sip of milk.
    const wanted = amount ?? (reason === 'firstHello' ? AFFINITY_FIRST_HELLO : AFFINITY_GAINS[reason]);
    const gain = Math.min(wanted, Math.max(0, AFFINITY_DAILY_CAP - earned));
    if (gain <= 0) return 0;

    const entry = pendingStats[today] ?? (pendingStats[today] = {});
    entry.affinity = (Number(entry.affinity) || 0) + gain;
    const before = (affinityTotal < 0 ? 0 : affinityTotal);
    affinityTotal = Math.min(AFFINITY_MAX, before + gain);
    const landed = affinityTotal - before;
    if (landed <= 0) return 0;

    showAffinityChip(landed);
    const levelBefore = affinityLevel(before);
    const levelAfter = affinityLevel(affinityTotal);
    if (reason === 'firstHello') {
      affinitySpokeAt = performance.now();
      say(liteT('affinity.gained', {
        n: landed, value: affinityTotal, level: affinityLevelName(levelAfter),
      }), 4200);
    }
    if (levelAfter > levelBefore) {
      showHearts();
      const maxed = affinityTotal >= AFFINITY_MAX;
      affinitySpokeAt = performance.now();
      say(maxed
        ? liteT('affinity.maxed')
        : liteT('affinity.levelUp', { level: levelAfter + 1, name: affinityLevelName(levelAfter) }), 6000);
    }
    statsFlushAt = statsFlushAt ? Math.min(statsFlushAt, performance.now() + STATS_FLUSH_MS) : performance.now() + STATS_FLUSH_MS;
    return landed;
  }

  /** The first interaction of the day is worth a hello. */
  function greetIfFirstToday() {
    if (!config) return;
    const today = liteDayKey();
    if ((config.statsDays ?? []).includes(today) || daysToAdd.has(today)) return;
    markActiveDay();
    awardAffinity('firstHello');
  }

  /** Remember that the pet was used today (drives "陪伴天数" and the hello bonus). */
  function markActiveDay() {
    daysToAdd.add(liteDayKey());
  }

  /**
   * Merge the buffered counters into the config and write them once.
   *
   * Everything the pet accumulates — the per-day buckets, the affinity score and
   * its one-point-per-day history, the lifetime click count, the days it was used
   * and the first day it was ever started — travels in a single patch, so a click
   * costs one config write at most every few seconds rather than one per event.
   */
  function flushStats() {
    if (!config) return;
    const days = Object.keys(pendingStats);
    if (!days.length && !daysToAdd.size && affinityTotal < 0 && !needsDirty && !achievementsDirty) return;
    const patch: Partial<AppConfig> = {};
    const merged: Record<string, DailyStat> = { ...(config.dailyStats ?? {}) };
    for (const day of days) {
      const target = merged[day] ?? (merged[day] = {});
      for (const [kind, value] of Object.entries(pendingStats[day])) {
        const key = kind as keyof DailyStat;
        target[key] = (Number(target[key]) || 0) + (Number(value) || 0);
      }
      delete pendingStats[day];
    }
    if (days.length) patch.dailyStats = liteDayPruneStats(merged, STATS_KEEP_DAYS);
    if (affinityTotal >= 0) {
      patch.affinity = affinityTotal;
      const history = (config.affinityHistory ?? []).filter(point => point?.date !== liteDayKey());
      history.push({ date: liteDayKey(), value: affinityTotal });
      // One point per day, oldest dropped: a growth curve, not a click log.
      patch.affinityHistory = history.slice(-AFFINITY_HISTORY_DAYS);
    }
    if (clicksTotal >= 0) patch.statsClicks = clicksTotal;
    // The pet is the only writer of its own needs, and it only writes them when
    // hunger has actually drifted (or a treat changed them), so this stays a
    // once-a-minute write rather than a per-frame one.
    if (needsDirty) {
      patch.petStats = { ...needs };
      needsDirty = false;
    }
    if (daysToAdd.size) {
      const known = new Set(config.statsDays ?? []);
      for (const day of daysToAdd) known.add(day);
      patch.statsDays = [...known].sort().slice(-STATS_KEEP_DAYS);
      daysToAdd.clear();
    }
    if (achievementsDirty) {
      // The whole shelf travels in one patch; the backend deep-merges the two
      // maps, so a badge earned in another window is never dropped.
      patch.achievements = {
        unlocked: { ...achievements.unlocked },
        counters: { ...achievements.counters },
      };
      achievementsDirty = false;
    }
    if (!config.statsFirstSeen) patch.statsFirstSeen = liteDayKey();
    void window.api.setConfig(patch)
      .catch(error => console.error('[lite-app] stats:', error));
  }

  // ---------- feeding and the cat teaser ----------
  /**
   * The pet owns two small loops here. Hunger drifts up while the app runs and a
   * treat takes it back down; the wand gives it something to jump at. Everything
   * that can be shared — the food table, the tray layout, the timelines — lives in
   * lite-care.ts so the settings panel prints exactly these numbers.
   *
   * A treat is only eaten when the pet is actually hungry, which is also what
   * keeps feeding from being a way to grind affection: only a handful land before
   * it is full again.
   */
  function markNeedsDirty(now: number) {
    needsDirty = true;
    const at = now + STATS_FLUSH_MS;
    statsFlushAt = statsFlushAt ? Math.min(statsFlushAt, at) : at;
  }

  /** One whole minute of hunger at a time, so the number creeps instead of jumping. */
  function driftHunger(now: number) {
    if (!needsSeeded) return;
    if (!hungerAt) { hungerAt = now; return; }
    const minutes = (now - hungerAt) / 60_000;
    if (minutes < 1) return;
    hungerAt = now;
    needs.hunger = careAdvanceHunger(needs.hunger, minutes);
    markNeedsDirty(now);
  }

  /** Show the tray above the pet's head. */
  function openTray() {
    if (!config || pressed || dragging || reminderRunning || eating || toy) return;
    activity();
    // A treat is also how you wake a sleeping cat up.
    sleepUntil = 0;
    nextSleep = performance.now() + 120_000;
    tray = { openedAt: performance.now() };
    say(liteT('lite.care.trayHint'), CARE_TRAY_LIFETIME_MS);
  }

  /** Eat one treat: it falls from the tray to the pet's paws, then disappears. */
  function startEating(food: CareFood) {
    if (!config || eating) return;
    const now = performance.now();
    if (!careWillEat(needs.hunger)) {
      activity();
      say(liteT('lite.care.full'), 2600);
      return;
    }
    const slot = careTraySlots().find(item => item.food.id === food.id);
    const from = slot ? { x: slot.x, y: slot.y } : { x: 150, y: CARE_TRAY_Y };
    activity();
    sleepUntil = 0;
    nextSleep = now + 120_000;
    tray = null;
    eating = { food, from, startedAt: now };
    // Consumed up front: dragging the pet away halfway through the animation is
    // not a reason to waste the treat.
    needs.hunger = careEat(food, needs.hunger);
    needs.mood = careClamp(needs.mood + food.mood);
    needs.energy = careClamp(needs.energy + food.energy);
    markNeedsDirty(now);
  }

  /**
   * End the meal: hearts, affection, and the line. `quiet` is for an interaction
   * that interrupted it — the points still land, the bubble belongs to whatever
   * the user just did.
   */
  function finishEating(quiet = false) {
    const done = eating;
    if (!done) return;
    eating = null;
    showHearts();
    const spent = performance.now();
    awardAffinity('feed', done.food.affinity);
    // A level-up bubble from that award outranks "yum"; leave it alone.
    if (!quiet && spent - affinitySpokeAt >= 600) say(liteT(done.food.lineKey), 3200);
    bumpAchievement('feeds');
    settleAchievements();
  }

  /** Start a play session: the wand swings, the pet lunges, catches pay off. */
  function startToy() {
    if (!config || pressed || dragging || reminderRunning || eating || tray || toy) return;
    const now = performance.now();
    activity();
    sleepUntil = 0;
    nextSleep = now + 120_000;
    toy = {
      startedAt: now,
      endsAt: now + CARE_TOY_SESSION_MS,
      nextPounceAt: now + CARE_TOY_FIRST_POUNCE_MS,
      catches: 0,
      pounce: null,
    };
    say(liteT('lite.care.toy.start'), 4200);
  }

  function endToy(quiet = false) {
    const session = toy;
    if (!session) return;
    // Cleared before the summary is built: a frame and a tap can both notice the
    // session is over in the same tick, and it must only end once.
    toy = null;
    if (quiet) return;
    say(session.catches > 0
      ? liteT('lite.care.toy.end', { n: session.catches })
      : liteT('lite.care.toy.endEarly'), 3600);
  }

  /** Per-frame half of the care loop (the hunger nudge runs on the 1 s timer). */
  function checkCare(now: number) {
    if (!config) return;
    driftHunger(now);
    if (tray && now - tray.openedAt >= CARE_TRAY_LIFETIME_MS) tray = null;
    if (eating && now - eating.startedAt >= CARE_EAT_DURATION_MS) finishEating();
    if (!toy) return;
    // Being carried, or held back by a reminder, is no time to chase a feather.
    if (dragging || reminderRunning) { endToy(true); return; }
    if (now >= toy.endsAt || toy.catches >= CARE_TOY_CATCH_LIMIT) { endToy(); return; }
    if (toy.pounce) {
      if (now < toy.pounce.until) return;
      toy.catches++;
      toy.pounce = null;
      toy.nextPounceAt = now + CARE_TOY_GAP_MIN_MS +
        Math.random() * (CARE_TOY_GAP_MAX_MS - CARE_TOY_GAP_MIN_MS);
      showHearts();
      awardAffinity('play');
      if (toy.catches === 1 && performance.now() - affinitySpokeAt >= 600) {
        say(liteT('lite.care.toy.catch'), 1600);
      }
      bumpAchievement('toyCatches');
      settleAchievements();
      return;
    }
    if (pressed || signVisible() || now < toy.nextPounceAt) return;
    const at = careToySwing(now - toy.startedAt);
    toy.pounce = { startedAt: now, until: now + CARE_TOY_POUNCE_MS, at };
    // Swat left, swat right: alternating keeps both paw poses in use.
    activeAction = {
      kind: toy.catches % 2 === 0 ? 'wave' : 'scratch',
      started: now,
      duration: CARE_TOY_POUNCE_MS,
    };
  }

  /** The pet mentions being hungry at most once every 25 minutes. */
  function checkHunger() {
    if (!config || !needsSeeded || !careIsHungry(needs.hunger)) return;
    if (pressed || dragging || reminderRunning || eating || toy || tray || signVisible()) return;
    const now = Date.now();
    if (now - lastHungryAt < CARE_HUNGRY_GAP_MS) return;
    lastHungryAt = now;
    say(liteT(careHungerLevel(needs.hunger) === 'starving' ? 'lite.care.starving' : 'lite.care.hungry'), 3600);
  }

  /**
   * What the care loop draws on top of the pet: the wand, the treat on its way
   * down, and the tray. Keeping all three here means the pet's own sprite is the
   * only thing the drawing branches have to worry about.
   */
  function drawCare(now: number) {
    if (toy) {
      const elapsed = now - toy.startedAt;
      const head = careToySwing(elapsed);
      // The feather dips towards the pet while it lunges, so the swat reads as
      // contact even though the wand never enters the pet's own box.
      const tip = { x: head.x, y: head.y + carePounceAmount(now, toy.pounce) * 26 };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#c98a5b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(CARE_TOY_GRIP.x, CARE_TOY_GRIP.y);
      ctx.quadraticCurveTo((CARE_TOY_GRIP.x + tip.x) / 2 + 8, (CARE_TOY_GRIP.y + tip.y) / 2, tip.x, tip.y);
      ctx.stroke();
      ctx.translate(tip.x, tip.y);
      ctx.rotate(Math.sin(elapsed / 260) * 0.35);
      ctx.fillStyle = '#ff8fb0';
      ctx.beginPath();
      ctx.ellipse(0, -7, 9, 18, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffc2d4';
      ctx.beginPath();
      ctx.ellipse(-7, -2, 6, 13, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2b24a';
      ctx.beginPath();
      ctx.arc(0, 9, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (eating) {
      const elapsed = now - eating.startedAt;
      const at = careEatPosition(eating, elapsed);
      const bite = Math.max(0, Math.min(1, careEatBite(elapsed)));
      const size = Math.round(24 * (0.7 + 0.3 * Math.min(1, elapsed / CARE_EAT_DROP_MS)) * (0.55 + 0.45 * bite));
      ctx.save();
      ctx.globalAlpha = Math.min(1, bite * 1.8);
      ctx.font = `${Math.max(10, size)}px "Segoe UI Emoji", "Apple Color Emoji", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(eating.food.icon, at.x, at.y);
      ctx.restore();
    }
    if (!tray) return;
    const willing = careWillEat(needs.hunger);
    for (const slot of careTraySlots()) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, slot.r, 0, Math.PI * 2);
      ctx.fillStyle = '#fffaf2f5';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = willing ? '#e9cbb6' : '#ddd3ca';
      ctx.stroke();
      // A pet that has just eaten still shows the tray, greyed out, so the
      // picture explains the refusal before the bubble says it.
      ctx.globalAlpha = willing ? 1 : 0.45;
      ctx.font = '24px "Segoe UI Emoji", "Apple Color Emoji", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slot.food.icon, slot.x, slot.y + 1);
      ctx.restore();
    }
  }

  // ---------- the health plan ----------
  /**
   * Three independent timers: the standing reminder the pet already had, plus a
   * look-away nudge and a drink-water nudge. Each is armed from `applyConfig`,
   * so changing the interval restarts that item's countdown and unchecking it
   * disarms it — the same contract the standing reminder has always had.
   */
  function checkHealthPlan() {
    if (!config) return;
    // A reminder is not worth interrupting a drag or another announcement for;
    // the timer stays armed and fires on the next tick instead.
    if (pressed || dragging || reminderRunning) return;
    const now = Date.now();
    if (config.eyeRestEnabled === true && nextEyeRestAt && now >= nextEyeRestAt) {
      nextEyeRestAt = now + litePetClampMinutes(config.eyeRestMinutes, 20) * 60_000;
      announceEyeRest();
    }
    if (config.waterEnabled === true && nextWaterAt && now >= nextWaterAt) {
      nextWaterAt = now + litePetClampMinutes(config.waterMinutes, 45) * 60_000;
      announceWater();
    }
  }

  function announceEyeRest() {
    activity();
    clickUntil = performance.now() + 700;
    playAction('stretch');
    // After the action: starting one clears whatever bubble was on screen.
    say(liteT('lite.pet.eyeRest'), 6000);
    bumpDaily('eye', true);
    bumpAchievement('healths');
    settleAchievements();
  }

  function announceWater() {
    activity();
    clickUntil = performance.now() + 900;
    say(liteT('lite.pet.water'), 6000);
    bumpDaily('water', true);
    bumpAchievement('healths');
    settleAchievements();
  }

  function checkReminders() {
    if (!config) return;
    const list = Array.isArray(config.reminders) ? config.reminders : [];
    if (!list.length) {
      handledReminders.clear();
      return;
    }
    // An id that has left the config finished its round trip; the pet is free to
    // notice the same id again if the user re-creates it.
    for (const id of Array.from(handledReminders)) {
      if (!list.some(item => item?.id === id)) handledReminders.delete(id);
    }
    const now = Date.now();
    const stale = list.filter(item => now - Number(item?.at) > REMINDER_GRACE_MS);
    const due = list.filter(item => {
      const at = Number(item?.at);
      return !!item?.text && at > 0 && at <= now && now - at <= REMINDER_GRACE_MS &&
        !handledReminders.has(item.id);
    });
    // Only the newest due reminder is announced; older ones in the same batch
    // would just queue up behind it.
    const next = due[due.length - 1];
    const free = !pressed && !dragging && !reminderRunning;
    const drop = new Set(stale.map(item => item.id));
    if (next && free) drop.add(next.id);
    if (drop.size) {
      void window.api.setConfig({ reminders: list.filter(item => !drop.has(item?.id)) })
        .catch(error => console.error('[lite-app] reminders:', error));
    }
    if (!next || !free) return;
    handledReminders.add(next.id);
    void runReminder(next.text);
  }

  // ---------- load awareness ----------
  // The pet mirrors the machine: a pinned CPU makes it sweat, a nearly empty
  // battery makes it nap, and plugging in wakes it right up. Everything here is
  // driven by `config.loadAwareness`, which is on by default and read-only in
  // the sense that nothing is ever sent back.
  const HOT_CPU = 85;
  const LOW_BATTERY = 20;
  const LOAD_POLL_MS = 4000;
  let lastLoadPoll = 0;

  function isLowBattery() {
    return !!load && load.available && load.batteryPercent !== null &&
      load.batteryPercent <= LOW_BATTERY && !load.charging;
  }

  function showMood(icon: string, until: number) {
    moodIcon = icon;
    moodUntil = Math.max(moodUntil, until);
    if (mood) mood.textContent = icon;
  }

  function reactToLoad(now: number) {
    if (!load || !load.available) return;
    // One hot reading is noise (a build step, a page load); two in a row is a
    // machine that is actually busy.
    hotPolls = load.cpu !== null && load.cpu >= HOT_CPU ? hotPolls + 1 : 0;
    if (hotPolls >= 2) {
      showMood('💦', now + LOAD_POLL_MS * 2);
      if (now - lastTiredAt > 5 * 60_000) {
        lastTiredAt = now;
        say(liteT('lite.pet.tired'), 3200);
      }
    }
    if (isLowBattery()) {
      showMood('🪫', now + LOAD_POLL_MS * 3);
      if (!lowBatteryAnnounced) {
        lowBatteryAnnounced = true;
        say(liteT('lite.pet.lowBattery'), 4000);
      }
    }
    if (load.batteryPercent === null) return;
    if (wasCharging === false && load.charging) {
      lowBatteryAnnounced = false;
      showMood('⚡', now + LOAD_POLL_MS * 2);
      say(liteT('lite.pet.pluggedIn'), 3200);
    }
    wasCharging = load.charging;
  }

  async function pollLoad() {
    if (!config || config.loadAwareness === false) {
      load = null;
      hotPolls = 0;
      moodIcon = '';
      moodUntil = 0;
      return;
    }
    try {
      load = await window.api.getSystemLoad();
    } catch (error) {
      // An older backend without the command (or a platform that cannot answer)
      // simply means no reactions.
      load = null;
      console.error('[lite-app] system load:', error);
      return;
    }
    reactToLoad(performance.now());
  }

  window.setInterval(() => {
    checkStandReminder();
    checkHealthPlan();
    checkHourlyChime();
    checkReminders();
    checkHunger();
    const now = performance.now();
    if (statsFlushAt && now >= statsFlushAt) {
      statsFlushAt = 0;
      flushStats();
    }
    if (now - lastLoadPoll >= LOAD_POLL_MS) {
      lastLoadPoll = now;
      void pollLoad();
    }
  }, 1000);

  async function loadCustom() {
    const serial = ++loadSerial;
    custom = null;
    customOutline = null;
    if (config?.skin !== 'custom') return;
    try {
      const record = await window.api.getCustomImage();
      if (!record.ok || !record.url) throw new Error(liteT('lite.image.missing'));
      const image = await liteLoadImage(record.url);
      // The automatic cutout already happened in Rust when the picture was
      // imported, so whatever is on disk is drawn as it is.
      const prepared = litePrepareImage(image);
      if (serial !== loadSerial) return;
      custom = prepared;
      customOutline = config?.customOutline ? litePetOutline(prepared.canvas) : null;
      (window as unknown as Record<string, unknown>).__petError = null;
    } catch (error) {
      if (serial !== loadSerial) return;
      // Always show the built-in cat if the custom image cannot be decoded.
      (window as unknown as Record<string, unknown>).__petError = `custom image: ${String(error)}`;
    }
  }

  /**
   * Load the installed pet pack the config names.
   *
   * The backend already validated the manifest and the sheet when it was
   * imported (src-tauri/src/petpack.rs), so this only has to find it and decode
   * the picture. A missing or unreadable pack leaves `pack` null, and `draw`
   * falls through to Bulu rather than leaving the window empty.
   */
  async function loadPack() {
    const serial = ++loadSerial;
    pack = null;
    packAnimation = '';
    if (config?.skin !== 'pack') return;
    const id = String(config.currentPetId ?? '');
    if (!id) return;
    try {
      const list = await window.api.petList();
      const entry = (list.pets ?? []).find(pet => pet?.id === id);
      if (!entry) throw new Error(liteT('lite.pack.notFound'));
      const source = entry.url ?? entry.spritesheet;
      if (!source) throw new Error(liteT('lite.pack.missingSheet', { file: id }));
      const sheet = await liteLoadImage(source);
      if (serial !== loadSerial) return;
      pack = { entry, sheet };
      (window as unknown as Record<string, unknown>).__petError = null;
    } catch (error) {
      if (serial !== loadSerial) return;
      (window as unknown as Record<string, unknown>).__petError = `pet pack: ${String(error)}`;
    }
  }

  function applyConfig(next: AppConfig) {
    const reload = !config || config.skin !== next.skin || config.customImagePath !== next.customImagePath ||
      config.customImageRevision !== next.customImageRevision ||
      config.customOutline !== next.customOutline ||
      // Switching between two packs changes nothing else, so the id is part of
      // what makes the appearance stale.
      config.currentPetId !== next.currentPetId;
    const reminderChanged = !config || config.standReminderEnabled !== next.standReminderEnabled ||
      config.standReminderMinutes !== next.standReminderMinutes;
    const chimeChanged = !config || config.hourlyChime !== next.hourlyChime;
    const healthChanged = !config || config.eyeRestEnabled !== next.eyeRestEnabled ||
      config.eyeRestMinutes !== next.eyeRestMinutes ||
      config.waterEnabled !== next.waterEnabled || config.waterMinutes !== next.waterMinutes;
    const loadChanged = !config || config.loadAwareness !== next.loadAwareness;
    // Strings come from the backend dictionary, so a language switch re-fetches it.
    const localeChanged = !config || config.locale !== next.locale;
    // The shelf is seeded once. After that this window owns it while it has
    // pending changes; a clean window still adopts a restored backup or an
    // external edit on the next broadcast.
    const firstAchievementConfig = !achievementsSeeded;
    if (firstAchievementConfig) achievementsSeeded = true;
    if (firstAchievementConfig || !achievementsDirty) achievements = achievementState(next);
    config = next;
    // The score and the lifetime click count only ever grow locally; a config
    // that already carries more (an older pet window, a hand-edited file) wins.
    affinityTotal = Math.max(affinityTotal < 0 ? 0 : affinityTotal, Number(next.affinity) || 0);
    clicksTotal = Math.max(clicksTotal < 0 ? 0 : clicksTotal, Number(next.statsClicks) || 0);
    if (firstAchievementConfig) settleAchievements(true);
    // The needs are taken from the config exactly once. From then on this window
    // owns them; a broadcast carrying the value it wrote a moment ago must not
    // roll the drift back.
    if (!needsSeeded) {
      const stats = next.petStats;
      needs = {
        mood: careStat(stats?.mood, CARE_NEEDS_DEFAULT.mood),
        energy: careStat(stats?.energy, CARE_NEEDS_DEFAULT.energy),
        hunger: careStat(stats?.hunger, CARE_NEEDS_DEFAULT.hunger),
      };
      needsSeeded = true;
      hungerAt = performance.now();
    }
    document.body.style.opacity = String(Math.max(0.5, Math.min(1, Number(next.opacity) || 1)));
    if (!next.autoMove) stopWalking();
    if (localeChanged) void liteLoadDictionary().catch(error => console.error('[lite-app] i18n:', error));
    if (reminderChanged) {
      reminderRunId++;
      reminderRunning = false;
      const minutes = Math.max(1, Math.min(240, Number(next.standReminderMinutes) || 5));
      nextReminderAt = next.standReminderEnabled === false ? 0 : Date.now() + minutes * 60_000;
    }
    if (chimeChanged) nextHourAt = next.hourlyChime === false ? 0 : litePetNextLocalHour(Date.now());
    if (healthChanged) {
      // Opt-in habits: a config that predates them (no key at all) arms nothing,
      // and only an explicit `true` starts a countdown.
      nextEyeRestAt = next.eyeRestEnabled === true ? Date.now() + litePetClampMinutes(next.eyeRestMinutes, 20) * 60_000 : 0;
      nextWaterAt = next.waterEnabled === true ? Date.now() + litePetClampMinutes(next.waterMinutes, 45) * 60_000 : 0;
    }
    // Reading the machine is cheap but not free, so it happens on that switch and
    // on the poll timer — never per frame.
    if (loadChanged) void pollLoad();
    if (reload) { void loadCustom(); void loadPack(); }
    // A new skin, size or opacity is drawn on the next frame; the loop may well be
    // asleep by now (a settings change while the pet stands still), so ask for one.
    scheduleFrame();
  }

  /**
   * The dream bubble is a sleeping thing, so the only state this cares about is
   * `sleep` — a thrown pet is very much awake.
   */
  function updateDream(state: 'idle' | 'walk' | 'sleep' | 'click' | 'thrown', now: number) {
    if (state !== 'sleep') {
      dream.hidden = true;
      nextDreamAt = 0;
      dreamUntil = 0;
      return;
    }
    if (!nextDreamAt) nextDreamAt = now + 1200;
    if (now >= nextDreamAt && speech.hidden) {
      const dreams = ['🐟', '⭐', '💤', '🧶'];
      dream.textContent = dreams[dreamIndex++ % dreams.length];
      dreamUntil = now + 1700;
      nextDreamAt = now + 5000;
    }
    dream.hidden = now >= dreamUntil || !speech.hidden;
    dream.style.left = `${Math.min(250, visibleRect.x + visibleRect.w * 0.68)}px`;
    dream.style.top = `${Math.max(6, visibleRect.y - 36)}px`;
  }

  /** Keep the load badge pinned above the pet's left shoulder while it is up. */
  function updateMood(now: number) {
    if (!mood) return;
    // Hunger shares this badge with the machine readings. A busy CPU or a dying
    // battery speaks first; an empty tummy shows whenever the load badge is quiet
    // — except while the pet is being fed, where the tray already says it and the
    // badge would sit half-hidden behind the speech bubble.
    const loadVisible = moodIcon !== '' && now < moodUntil;
    const hungry = careIsHungry(needs.hunger) && !tray && !eating;
    const icon = loadVisible ? moodIcon : hungry ? '🍽️' : '';
    mood.hidden = icon === '';
    if (!icon) return;
    mood.textContent = icon;
    mood.style.left = `${Math.max(6, visibleRect.x + visibleRect.w * 0.08)}px`;
    mood.style.top = `${Math.max(14, visibleRect.y - 28)}px`;
  }

  /** True while a reminder sign is on screen (the pet stays put for it). */
  function signVisible() {
    return !!sign && !sign.hidden;
  }

  function currentState(now: number): 'idle' | 'walk' | 'sleep' | 'click' {
    if (reminderRunning) return 'walk';
    // A meal and a pounce are both "busy" states: they hold the pet in place and
    // keep it from falling asleep halfway through.
    if (eating || (toy && toy.pounce)) return 'click';
    if (tray || toy) return 'idle';
    if (activeAction && now < activeAction.started + activeAction.duration) return 'click';
    if (clickUntil > now) return 'click';
    if (walkUntil > now) return 'walk';
    if (now < sleepUntil) return 'sleep';
    if (now >= nextSleep) {
      // A machine running out of battery drags the pet down with it: it naps
      // more often and for longer until the charger shows up.
      const low = isLowBattery();
      sleepUntil = now + (low ? 32_000 : 20_000);
      nextSleep = now + (low ? 55_000 : 120_000);
      return 'sleep';
    }
    return 'idle';
  }

  function update(now: number) {
    // A flying pet owns the window: no walk, no reminder trip, no chime may fight
    // the flight for the position while it is in the air. The flight lasts a couple
    // of seconds at most (friction ends it), so nothing else is starved by this.
    if (flight) { stepFlight(now); return; }
    if (!config || dragging || reminderRunning) return;
    if (activeAction) {
      if (now < activeAction.started + activeAction.duration) return;
      activeAction = null;
    }
    if (walkUntil && now >= walkUntil) stopWalking();
    // The pet stands still for a meal, the tray and the whole play session; the
    // hunger clock and the wand keep running from `checkCare`.
    if (eating || tray || toy) return;
    // A pet holding up a reminder stays where the user can read it.
    if (!config.autoMove || walkUntil || now < nextWalk || signVisible() || currentState(now) === 'sleep') return;
    facing = Math.random() < 0.5 ? -1 : 1;
    walkUntil = now + 1600 + Math.random() * 1800;
    // The glide speed is derived from the gait, not tuned beside it: the stride
    // length over the stride duration, so the feet stay planted whether the pet
    // is resized or the animation speed changes. An imported pack declares its own
    // walking fps, so its legs are compared against the built-in 8 fps rather than
    // being assumed to match it.
    const packRate = pack ? litePackWalkFps(pack.entry.manifest) / gaitFps() : 1;
    gaitStartedAt = now;
    window.api.autoMoveStart(facing, gaitSpeed(gaitRate(config.animSpeed) * (packRate || 1), config.petScale));
  }

  function draw(now: number) {
    syncPixelRatio();
    ctx.clearRect(0, 0, 300, 300);
    // Airborne outranks everything the pet wanted to do: a thrown pet is being
    // flung, and the pose has to say so until it lands.
    const state: 'idle' | 'walk' | 'sleep' | 'click' | 'thrown' =
      flight ? 'thrown' : dragging ? 'walk' : currentState(now);
    const action = activeAction && now < activeAction.started + activeAction.duration ? activeAction : null;
    const sizeScale = gaitSize(config?.petScale);
    // The resting state is deliberately motionless: the pet only animates while it
    // walks (auto-walk or dragging), clicks or sleeps.
    //
    // The walking gait is measured from the start of *this* walk (lite-gait.ts):
    // the legs, the body bob and the glide Rust is running all read one phase, so
    // the pet begins on a contact frame and the bob punctuates the steps instead
    // of drifting through them. It used to be `Math.sin(now / 100)` — a 628 ms
    // period against a 500 ms cycle — which read as floating rather than walking.
    if (state === 'walk') { if (!gaitStartedAt) gaitStartedAt = now; } else { gaitStartedAt = 0; }
    const walkElapsed = gaitStartedAt ? now - gaitStartedAt : 0;
    const gaitRateNow = gaitRate(config?.animSpeed);
    const bob = action ? 0
      : state === 'walk' ? gaitBob(walkElapsed, gaitRateNow)
      : state === 'click' ? -Math.abs(Math.sin(now / 90)) * 3
      : 0;
    // The care loop moves the whole pet instead of the sprite frames: up and
    // towards the wand during a lunge, down towards the treat while chewing. The
    // offset is folded into `x`/`y` so `visibleRect` keeps describing where the
    // pet actually ended up.
    const pounce = toy ? carePounceAmount(now, toy.pounce) : 0;
    const shiftX = toy?.pounce ? (toy.pounce.at.x - 150) * 0.12 * pounce : 0;
    const shiftY = -20 * pounce + (eating ? careChewDip(now - eating.startedAt) : 0);
    // An unknown skin (an install from before the line-up was trimmed) rides the
    // Bulu art rather than leaving the window blank.
    const target = config?.skin === 'custom' && custom ? 'custom'
      : config?.skin === 'pack' && pack ? 'pack'
      : config?.skin && sheets[config.skin] ? config.skin : 'bulu';

    ctx.save();
    ctx.globalAlpha = state === 'sleep' ? 0.78 : 1;
    if (target === 'bulu' && state === 'thrown' && buluAirborne.complete && buluAirborne.naturalWidth) {
      // Its own four-frame wriggle, not the walking row: legs pedalling in mid-air
      // read as walking, which is exactly what a thrown pet must not look like.
      const cell = buluAirborne.naturalWidth / 4;
      const frame = Math.floor(now / AIRBORNE_FRAME_MS) % 4;
      const size = 132 * sizeScale * AIRBORNE_DRAW_SCALE;
      const x = 150 - size / 2 + shiftX, y = 293 - size + shiftY;
      ctx.imageSmoothingEnabled = true;
      if (facing > 0) {
        ctx.translate(300, 0); ctx.scale(-1, 1);
      }
      leanForFlight(state, x + size / 2, y + size / 2, facing > 0);
      ctx.drawImage(buluAirborne, frame * cell, 0, cell, cell, x, y, size, size);
      visibleRect = { x, y, w: size, h: size };
    } else if (target === 'bulu' && action && buluActions.complete && buluActions.naturalWidth) {
      const cell = buluActions.naturalWidth / ACTION_FRAMES;
      const progress = (now - action.started) / action.duration;
      const column = Math.min(ACTION_FRAMES - 1, Math.max(0, Math.floor(progress * ACTION_FRAMES)));
      const size = 132 * sizeScale;
      const x = 150 - size / 2 + shiftX, y = 293 - size + shiftY;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buluActions, column * cell, actionRows[action.kind] * cell, cell, cell, x, y, size, size);
      visibleRect = { x, y, w: size, h: size };
    } else if (target === 'custom' && custom) {
      const bounds = custom.bounds;
      const fit = Math.min(145 / bounds.width, 148 / bounds.height) * sizeScale;
      const progress = action ? (now - action.started) / action.duration : 0;
      const pulse = action ? Math.sin(Math.PI * progress) : 0;
      const heightScale = action?.kind === 'stretch' ? 1 + pulse * 0.08 : action?.kind === 'yawn' ? 1 - pulse * 0.05 : 1;
      const lift = action?.kind === 'wave' || action?.kind === 'groom' ? Math.abs(Math.sin(progress * Math.PI * 4)) * 3 : 0;
      const width = bounds.width * fit, height = bounds.height * fit * heightScale;
      const x = 150 - width / 2 + shiftX, y = 293 - height + bob - lift + shiftY;
      ctx.imageSmoothingEnabled = true;
      // The picture pet is never mirrored, so its lean is a plain screen-space one.
      leanForFlight(state, x + width / 2, y + height / 2, false);
      if (customOutline) {
        // Stamp the silhouette around the picture for a sticker edge. The
        // thickness tracks the on-screen size, so it looks the same at any
        // petScale.
        const edge = Math.max(1, Math.round(width * 0.012));
        for (const [dx, dy] of OUTLINE_OFFSETS) {
          ctx.drawImage(customOutline, bounds.x, bounds.y, bounds.width, bounds.height,
            x + dx * edge, y + dy * edge, width, height);
        }
      }
      ctx.drawImage(custom.canvas, bounds.x, bounds.y, bounds.width, bounds.height, x, y, width, height);
      visibleRect = { x, y, w: width, h: height };
    } else if (target === 'pack' && pack && pack.sheet.complete && pack.sheet.naturalWidth) {
      // An imported character is drawn straight out of its own sheet: the state
      // picks the animation (`lite-pack.ts`), and an action the pack happens to
      // declare of that name wins over it. A pack without `wave` therefore still
      // walks and sleeps normally instead of freezing on a missing clip.
      const definition = pack.entry.manifest;
      const wanted = action ? action.kind : litePackStateName(state);
      const name = litePackAnimationName(definition, wanted) ?? '';
      if (name !== packAnimation) { packAnimation = name; packAnimationStartedAt = now; }
      const animation = name ? litePackAnimation(definition, name) : null;
      if (animation) {
        // A walk is measured from the start of the walk (the gait's clock), every
        // other animation from the moment it was selected.
        const elapsed = state === 'walk' ? walkElapsed : now - packAnimationStartedAt;
        const slot = animation.frames[litePackFrameIndex(animation, elapsed)];
        const frame = litePackFrameRect(definition, slot);
        const fit = Math.min(148 / frame.w, 148 / frame.h) * sizeScale * (Number(definition.sprite.scale) || 1);
        const width = frame.w * fit, height = frame.h * fit;
        const x = 150 - width / 2 + shiftX, y = 293 - height + bob + shiftY;
        ctx.imageSmoothingEnabled = true;
        if (facing > 0) {
          ctx.translate(300, 0); ctx.scale(-1, 1);
        }
        leanForFlight(state, x + width / 2, y + height / 2, facing > 0);
        ctx.drawImage(pack.sheet, frame.x, frame.y, frame.w, frame.h, x, y, width, height);
        visibleRect = { x, y, w: width, h: height };
      }
    } else {
      const image = sheets[target];
      if (image?.complete && image.naturalWidth) {
        const cell = image.naturalWidth / 4;
        // In the air the legs cycle faster than a walk: the same four frames, read
        // as flailing rather than as stepping.
        const frame = state === 'walk' ? gaitFrame(walkElapsed, gaitRateNow)
          : Math.floor(now / (state === 'thrown' ? 60 : 220)) % 4;
        // Bulu's resting pose blinks; walking, sleeping and the click answer play
        // their own frames. The blink cell only exists in the bundled sheet, so an
        // imported picture is never asked for one.
        const blink = target === 'bulu' ? blinkColumn(now, state, !!action) : 0;
        const column = target === 'bulu' && state === 'idle' ? blink : frame;
        const row = action ? action.kind === 'yawn' ? 2 : 3
          // Only reached when the airborne strip failed to load: the walk row is the
          // stand-in, and it is drawn faster in the air than on the ground.
          : state === 'walk' || state === 'thrown' ? 1
          : state === 'sleep' ? 2 : state === 'click' ? 3 : 0;
        const size = 132 * sizeScale;
        const x = 150 - size / 2 + shiftX, y = 293 - size + bob + shiftY;
        // Bulu is a drawn illustration: smoothing preserves the fur details
        // when the 192 px poses are scaled to the on-screen size.
        ctx.imageSmoothingEnabled = true;
        // The original default sheet faces left in every row. Mirror it when
        // the pet moves right, including its walking row.
        if (facing > 0) {
          ctx.translate(300, 0); ctx.scale(-1, 1);
        }
        leanForFlight(state, x + size / 2, y + size / 2, facing > 0);
        ctx.drawImage(image, column * cell, row * cell, cell, cell, x, y, size, size);
        visibleRect = { x, y, w: size, h: size };
      }
    }
    ctx.restore();
    drawCare(now);
    updateDream(state, now);
    updateMood(now);
    // The sign follows the pet instead of being pinned to wherever it arrived.
    if (signVisible()) sign!.style.bottom = `${Math.min(248, 300 - visibleRect.y + 44)}px`;
    if (!speech.hidden) speech.style.bottom = `${Math.min(240, 300 - visibleRect.y + 6)}px`;
  }

  async function pollEdge(now: number) {
    if (!walkUntil || now - lastEdgePoll < 260) return;
    lastEdgePoll = now;
    const gaps = await window.api.windowEdgeGaps(visibleRect).catch(() => null);
    if (gaps && (facing < 0 ? gaps.left : gaps.right) < 16) stopWalking();
  }

  /**
   * How long an idle pet may go without a frame. The pet's own one-second check
   * tick (reminders, hunger, the hourly chime, the machine reading) keeps running
   * on its own timer, so this is only a backstop for anything those checks turn on.
   */
  const IDLE_WAKE_MS = 1000;
  /** A wake-up that is already armed, or null while the loop is running. */
  let wakeTimer: number | null = null;
  /** True between asking for a frame and running it, so two callers cannot double up. */
  let framePending = false;

  /**
   * Is anything on screen moving by itself right now?
   *
   * Every reason to keep drawing at full rate has to be in here, or the pet freezes
   * until something else wakes it: the flight integrates, a drag plays the walking
   * gait, a held button can still become a long press, a reminder trip walks the pet
   * to the middle of the screen, and the states that read the clock (`walk` / `click`
   * body bob, the tray, a meal, the feather wand) all animate from `now`.
   */
  function animating(now: number): boolean {
    if (flight || dragging || pressed || reminderRunning) return true;
    if (walkUntil > now || clickUntil > now) return true;
    if (activeAction && now < activeAction.started + activeAction.duration) return true;
    if (tray || eating || toy) return true;
    return false;
  }

  /** When a sleeping loop has to look again, in milliseconds from now. */
  function nextWakeDelay(now: number): number {
    let wake = now + IDLE_WAKE_MS;
    // Blinking is the only sub-second event of an idle pet, and the closed-eye
    // frame is held for 150 ms: both edges of it are deadlines, or the eyes would
    // stay shut until the next heartbeat.
    if (blinkUntil > now) wake = Math.min(wake, blinkUntil);
    else if (nextBlinkAt > now) wake = Math.min(wake, nextBlinkAt);
    if (activeAction) wake = Math.min(wake, activeAction.started + activeAction.duration);
    if (walkUntil > now) wake = Math.min(wake, walkUntil);
    if (sleepUntil > now) wake = Math.min(wake, sleepUntil);
    if (dreamUntil > now) wake = Math.min(wake, dreamUntil);
    return Math.max(0, wake - now);
  }

  /**
   * Ask for a frame from outside the loop.
   *
   * The loop sleeps while nothing moves, so a state change made by an event (the
   * button going down, a stroke, a menu action, a new skin) has to wake it or the
   * pet would look frozen until its one-second backstop happened to fire. Calling
   * this twice is harmless: the second call finds a frame already on its way.
   */
  function scheduleFrame() {
    if (framePending) return;
    if (wakeTimer !== null) {
      window.clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    framePending = true;
    requestAnimationFrame(frame);
  }

  /**
   * The pet's frame loop.
   *
   * It used to re-arm itself unconditionally, so the canvas was repainted 60 times
   * a second for as long as the app ran — including the hours it spends standing
   * still, where nothing changes between two blinks. An app that sells itself on
   * being a lightweight desktop pet cannot idle at 60 fps, so a frame is only asked
   * for while something is actually moving and the loop sleeps (at most a second at
   * a time) otherwise.
   *
   * Being the loop's only entry point, `frame` stays callable directly: the test
   * harnesses drive it by hand with their own clock.
   */
  function frame(now: number) {
    framePending = false;
    wakeTimer = null;
    try {
      checkLongPress(now);
      checkCare(now);
      update(now);
      void pollEdge(now);
      draw(now);
    } catch (error) {
      (window as unknown as Record<string, unknown>).__petError = `draw: ${String(error)}`;
    }
    if (animating(now)) {
      framePending = true;
      requestAnimationFrame(frame);
      return;
    }
    wakeTimer = window.setTimeout(scheduleFrame, nextWakeDelay(now));
  }

  // ---------- taps, double taps and holds ----------
  /** Long enough to read as a deliberate hold, short enough not to feel stuck. */
  const LONG_PRESS_MS = 700;
  const DOUBLE_TAP_MS = 320;

  function isAsleep(now: number) {
    return sleepUntil > now;
  }

  /** One tap: a word from the spot that was touched, or a sleepy complaint. */
  function tapReaction(region: PetRegion, now: number) {
    // Touching the pet ends a play session, with a summary of how it went.
    if (toy) { endToy(); return; }
    // A level-up (or the first hello of the day) says something worth more than
    // the poke line, and it came from this very tap.
    if (now - affinitySpokeAt < 600) return;
    if (isAsleep(now)) {
      // Woken up on purpose: the pet sits up first, then grumbles.
      sleepUntil = 0;
      nextSleep = now + 120_000;
      dream.hidden = true;
      say(liteT('lite.pet.sleepPoke'), 2400);
      return;
    }
    say(liteT(region === 'head' ? 'lite.pet.pokeHead' : 'lite.pet.pokeBody'), 2200);
  }

  /**
   * A hold that never turned into a drag. Checked from the frame loop rather than
   * a timer: while the pointer rests on the pet no pointer event arrives to
   * notice it, and the loop is already running anyway.
   */
  function checkLongPress(now: number) {
    if (!pressed || dragging || longPressFired || reminderRunning || !config) return;
    if (now - pressStartedAt < LONG_PRESS_MS) return;
    longPressFired = true;
    // Held too long: the pet stops enjoying it, scratches its head and asks.
    activity();
    activeAction = { kind: 'scratch', started: now, duration: 2100 };
    say(liteT('lite.pet.longPress'), 2600);
    bumpAchievement('holds');
    settleAchievements();
  }

  function hit(x: number, y: number) {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= 300 || py >= 300) return false;
    // Care props live on the same canvas, so they are part of the hit test by
    // default. The tray is meant to be clicked; the wand is only there to look
    // at, and letting it capture the cursor would swallow clicks aimed at the
    // desktop wherever the feather happens to be.
    if (tray && careFoodAt(x, y)) return true;
    if (toy && careToyHits(x, y, careToySwing(performance.now() - toy.startedAt))) return false;
    // `getImageData` reads backing-store pixels and ignores the context transform,
    // while every caller here passes CSS (0-300) coordinates — so the lookup has
    // to move with the pixel ratio. Reading CSS pixels straight was what made the
    // pet stay click-through on any scaled display: no dragging, no right-click
    // menu, because both are gated on this test.
    try { return ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data[3] > 24; }
    catch { return px >= visibleRect.x && px <= visibleRect.x + visibleRect.w && py >= visibleRect.y && py <= visibleRect.y + visibleRect.h; }
  }
  (window as unknown as { __boolooHitTest: (x: number, y: number) => boolean }).__boolooHitTest = hit;
  (window as unknown as { __boolooVisualBounds: () => PetBox }).__boolooVisualBounds = () => visibleRect;

  window.api.onFileDrop(({ paths, position }) => {
    if (config?.fileDropReactions === false || !Array.isArray(paths) || paths.length === 0 ||
        !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const scale = window.devicePixelRatio || 1;
    if (!hit(position.x / scale, position.y / scale)) return;
    activity();
    clickUntil = performance.now() + 1100;
    // Ask before marking: the hello bonus means "today has not been seen yet",
    // and marking the day first would answer that question itself.
    greetIfFirstToday();
    markActiveDay();
    awardAffinity('fileDrop');
    say(liteFileReaction(paths));
    bumpAchievement('fileDrops');
    settleAchievements();
  });
  window.api.onPetAction(playAction);
  // The right-click menu and the settings panel both reach the pet through this
  // one event; the payload is "tray", "toy" or "feed:<id>".
  window.api.onPetCare((action) => {
    if (action === 'tray') { openTray(); return; }
    if (action === 'toy') { startToy(); return; }
    if (action.startsWith('feed:')) {
      const food = careFoodById(action.slice(5));
      if (food) startEating(food);
    }
  });

  canvas.addEventListener('mousemove', (event) => {
    // A pointer on the move can be a stroke, a drag or a hover reaction, and every
    // one of those is drawn: the loop sleeps while nothing happens, so it is woken
    // here rather than by its one-second backstop.
    scheduleFrame();
    petStrokeMove(event.offsetX, event.offsetY, event.buttons);
    const over = dragging || pressed || hit(event.offsetX, event.offsetY);
    if (over !== lastHover) {
      lastHover = over;
      window.api.setClickThrough(!over);
      canvas.style.cursor = over ? 'grab' : 'default';
    }
    if (!pressed) return;
    // The last position still counts as part of the gesture: the release that ends
    // the throw is usually the button coming up during a move, not a separate event.
    sampleDrag(event.screenX, event.screenY);
    if (event.buttons === 0) { release(); return; }
    if (!dragging && Math.hypot(event.screenX - pressAt.x, event.screenY - pressAt.y) > 5) {
      dragging = true; activity(); canvas.style.cursor = 'grabbing';
      const initialDx = event.screenX - pressAt.x;
      if (Math.abs(initialDx) >= 2) facing = initialDx < 0 ? -1 : 1;
      lastDragScreenX = event.screenX;
    }
    if (dragging) {
      const dx = event.screenX - lastDragScreenX;
      if (Math.abs(dx) >= 2) facing = dx < 0 ? -1 : 1;
      lastDragScreenX = event.screenX;
      window.api.dragMove();
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !hit(event.offsetX, event.offsetY)) return;
    // A held button is one of the states the loop stays awake for (the long press is
    // noticed from a frame), so waking it here is what starts that clock.
    scheduleFrame();
    // Grabbing a pet in mid-air catches it: the flight ends where it was caught,
    // and the drag that follows starts from there like any other.
    flight = null;
    dragSamples.length = 0;
    sampleDrag(event.screenX, event.screenY);
    // A tap on a treat feeds it; a tap anywhere else on the pet while the tray is
    // up puts the tray away and falls through to the normal tap reaction.
    if (tray) {
      const food = careFoodAt(event.offsetX, event.offsetY);
      if (food) {
        event.preventDefault();
        tray = null;
        startEating(food);
        return;
      }
      tray = null;
    }
    reminderRunId++;
    reminderRunning = false;
    resetPetting();
    pressed = true; pressAt = { x: event.screenX, y: event.screenY };
    pressRegion = regionAt(event.offsetX, event.offsetY) ?? 'body';
    pressStartedAt = performance.now();
    longPressFired = false;
    activity(); window.api.dragBegin(visibleRect);
  });
  function release() {
    if (!pressed) return;
    const wasDragging = dragging;
    // One judgement call, two gates (src/renderer/lite-throw.ts): the hand had to be
    // fast somewhere in the window *and* still moving when the button came up. It is
    // made here, before the drag is handed back, because the answer also decides
    // whether the drop may dock the pet to a screen edge — a flick starts its flight
    // from exactly where the cursor is, so the magnet stays out of that gesture.
    const velocity = wasDragging ? throwRelease(dragSamples) : null;
    window.api.dragEnd(visibleRect, !velocity);
    pressed = false; dragging = false; canvas.style.cursor = 'grab';
    // A drag that ended fast enough becomes a throw; anything slower is a
    // placement, and the pet simply stays where it was dropped.
    if (wasDragging) { void launchThrow(velocity); return; }
    // A tap answers from where the pet was touched; two taps in quick succession
    // are read as affection rather than as two pokes.
    const now = performance.now();
    // Every tap counts towards the day's heatmap square, whether the pet was
    // asleep, happy about it or not.
    bumpDaily('clicks');
    clicksTotal = (clicksTotal < 0 ? 0 : clicksTotal) + 1;
    greetIfFirstToday();
    markActiveDay();
    awardAffinity('tap');
    noteTapMoment();
    clickUntil = now + 580;
    activity();
    const double = now - lastTapAt < DOUBLE_TAP_MS;
    lastTapAt = now;
    // A tap during a play session always goes to the toy, so the session ends
    // with its own summary instead of being read as a second pat.
    if (!double || toy) {
      tapReaction(pressRegion, now);
      settleAchievements();
      return;
    }
    activity();
    showHearts();
    playAction('wave');
    awardAffinity('doubleTap');
    bumpAchievement('doubleTaps');
    // After the action: starting one clears whatever bubble was on screen.
    say(liteT('lite.pet.doubleTap'), 2400);
    settleAchievements();
  }
  window.addEventListener('mouseup', (event) => {
    // The release position is part of the gesture, not just the end of it: when the
    // pointer stopped before letting go, this sample is the still tail that tells
    // `throwRelease` the pet was placed rather than thrown.
    //
    // A synthetic mouse-up carries no coordinates — and `screenX` would default to
    // 0 rather than to "unknown" — so it is only sampled when there is a real press
    // and a real position, or it would read as a flick into the top-left corner.
    if (pressed && Number.isFinite(event?.screenX) && Number.isFinite(event?.screenY)) {
      sampleDrag(event.screenX, event.screenY);
    }
    release();
  });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (hit(event.offsetX, event.offsetY)) window.api.showContextMenu();
  });

  void window.api.getConfig().then((cfg) => {
    applyConfig(cfg);
    window.api.onConfigChanged(applyConfig);
    window.api.onUpdateState(announceUpdate);
    // Let the pet settle on screen before it talks to the network.
    window.setTimeout(() => {
      if (config?.updateAutoCheck === false) return;
      void checkForUpdates();
    }, 9000);
    scheduleFrame();
  }).catch((error) => {
    (window as unknown as Record<string, unknown>).__petError = `config: ${String(error)}`;
    scheduleFrame();
  });
})();
