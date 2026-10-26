import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));

let clock = 0;
let wallClock = 0;
let locale = 'zh';
let configChanged;
let actionReceived;
let careReceived;
let updateState;
let frame;
let lastDraw;
/** Patches the pet window wrote back, in order (reminder bookkeeping). */
const configPatches = [];
/** What the pet window believes the config is, kept in step with the patches. */
let currentConfig = {};
/** Local day key of a timestamp, mirroring src/renderer/lite-day.ts. */
const dayKeyOf = (time) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
/** What the (stubbed) backend answers for `system_load`. */
let loadState = { available: false, cpu: null, memory: null, batteryPercent: null, charging: false };
/** Every drawImage the pet window issued, so a single frame can be asserted on. */
const drawHistory = [];
const transforms = [];
const intervals = [];
const moves = [];
/** Frames the pet asked for, and the delays it armed — the idle-loop contract. */
let framesRequested = 0;
const timeoutDelays = [];
const canvasEvents = new Map();
const windowEvents = new Map();
/** Every pixel the pet window looked up while hit-testing, in backing-store px. */
const hitSamples = [];
let speechCount = 0;
const speech = { hidden: true, style: {}, get textContent() { return this.line || ''; }, set textContent(value) { this.line = value; speechCount++; } };
const hearts = { hidden: true, style: {}, offsetWidth: 20 };
const affinityChip = { hidden: true, style: {}, textContent: '' };
const dream = { hidden: true, style: {}, textContent: '' };
const sign = { hidden: true, style: {}, textContent: '' };
const mood = { hidden: true, style: {}, textContent: '' };
class FakeDate extends Date {
  constructor(value = wallClock) { super(value); }
  static now() { return wallClock; }
}
const drawing = {
  clearRect() {}, save() {}, restore() {}, translate() {}, scale(...args) { transforms.push(args); },
  drawImage(...args) { lastDraw = args; drawHistory.push(args); },
  getImageData: (x, y) => { hitSamples.push([x, y]); return { data: [0, 0, 0, 255] }; },
  // The care props: the tray bubbles, the falling treat and the wand. None of
  // them is asserted through the canvas, so the stubs only have to not throw.
  beginPath() {}, moveTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {},
  fill() {}, stroke() {}, rotate() {}, fillText() {},
};
const canvas = {
  style: {}, getContext: () => drawing,
  addEventListener: (name, callback) => canvasEvents.set(name, callback),
};
const api = {
  getConfig: async () => ({ ...currentConfig }),
  getI18n: async () => ({ locale, dict: locale === 'en' ? enDict : zhDict }),
  // Any broadcast — from a patch or from the test — records what the pet will
  // believe, exactly like the real `config-changed` event does.
  onConfigChanged: callback => {
    configChanged = (cfg) => { currentConfig = { ...cfg }; callback(cfg); };
  },
  onPetAction: callback => { actionReceived = callback; },
  onPetCare: callback => { careReceived = callback; },
  onFileDrop: () => () => {},
  setClickThrough() {}, autoMoveStop() {}, autoMoveStart() {},
  dragBegin() {}, dragMove() {}, dragEnd() {},
  getWindowPosition: async () => [100, 100],
  getWindowCenterTarget: async () => [810, 294],
  moveWindowTo: async (x, y) => { moves.push([x, y]); },
  windowEdgeGaps: async () => null,
  // The bounce box Rust would compute: the pet lives inside 0..1920 × 0..1040 with
  // a 300 px window whose visible box is inset by (100, 170).
  flightBounds: async () => ({ ok: true, minX: -100, minY: -170, maxX: 1720, maxY: 750 }),
  getSystemLoad: async () => loadState,
  // Mirrors the real backend: the patch is merged, persisted and broadcast back,
  // which is what makes the daily counters accumulate across batches.
  setConfig: async (patch) => {
    configPatches.push(patch);
    currentConfig = { ...currentConfig, ...patch };
    queueMicrotask(() => configChanged?.({ ...currentConfig }));
    return currentConfig;
  },
  updateCheck: async () => ({ status: 'available', currentVersion: '0.6.5', version: '0.6.6',
    autoCheck: true, autoDownload: true, channel: 'stable' }),
  updateDownload: async () => ({ status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
    autoCheck: true, autoDownload: true, channel: 'stable' }),
  onUpdateState: callback => { updateState = callback; },
};
const browser = {
  // A non-1 ratio on purpose: the canvas backing store is 300*dpr while every
  // hit test is fed CSS coordinates, and mixing the two broke dragging and the
  // right-click menu on any scaled display.
  api, devicePixelRatio: 2,
  setInterval: callback => { intervals.push(callback); return intervals.length; },
  setTimeout: (callback, delay) => {
    timeoutDelays.push(delay);
    if (delay === 32) { clock += 125; queueMicrotask(callback); }
    return 1;
  },
  clearTimeout() {}, addEventListener: (name, callback) => windowEvents.set(name, callback),
};
const context = {
  window: browser, document: {
    body: { style: {} },
    documentElement: {},
    querySelectorAll: () => [],
    getElementById: id => ({
      'pet-canvas': canvas, 'pet-speech': speech, 'pet-hearts': hearts, 'pet-dream': dream,
      'pet-sign': sign, 'pet-mood': mood,
      'pet-affinity': affinityChip,
    })[id],
  },
  // The atlas is 16 frames wide at 192 px per frame (see scripts/build-bulu-actions.mjs).
  // `_src` is kept so a test can tell which atlas a frame was drawn from.
  Image: class {
    complete = true;
    naturalWidth = 512;
    set src(url) { this._src = url; if (url.includes('bulu-actions')) this.naturalWidth = 16 * 192; }
  },
  performance: { now: () => clock }, Date: FakeDate,
  requestAnimationFrame(callback) { framesRequested++; frame = callback; },
  queueMicrotask, Math, Number, Promise, console,
};
vm.createContext(context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-i18n.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-day.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-affinity.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-achievements.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-care.js'), 'utf8'), context);
// The gait owns the walking frame, the body bob and the glide speed, and the
// pack model owns how an imported character is drawn — the pet loop calls into
// both, so they load in the same order index.html loads them.
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-gait.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-pack.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-throw.js'), 'utf8'), context);
// The pet loop's two pure helpers: the chime's next hour / reminder bounds and
// the sticker outline it stamps from a cutout.
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-pet-timing.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-pet-outline.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist/renderer/lite-app.js'), 'utf8'), context);
await new Promise(resolve => setImmediate(resolve));

// The first drawn frame is the resting state: it comes from the base sheet's idle
// row (cell 128 px in this harness, row 0) and is a still pose.
frame(clock += 16);
assert.ok(drawHistory.some(args => args[3] === 128 && args[2] === 0),
  'the idle state should draw the base sheet idle row');

// The resting pose blinks: the sheet's fourth idle cell is the closed-eye frame
// scripts/build-bulu-blink.mjs bakes in, and it has to appear every few seconds
// without turning the pet into a metronome.
drawHistory.length = 0;
for (let i = 0; i < 240; i++) frame(clock += 50);
const idleFrames = drawHistory.filter(args => args[2] === 0);
const blinkFrames = idleFrames.filter(args => args[1] === 3 * 128);
assert.ok(blinkFrames.length > 0, 'the resting pet should blink every few seconds');
assert.ok(blinkFrames.length < idleFrames.length / 4,
  `blinking must stay occasional, got ${blinkFrames.length}/${idleFrames.length} frames`);
assert.ok(idleFrames.every(args => args[1] === 0 || args[1] === 3 * 128),
  'the idle row only contains the open pose and the baked blink pose');

// A frame is only asked for while something is actually moving. The loop re-armed
// itself unconditionally before this, which repainted the canvas 60 times a second
// for as long as the app ran — including the hours the pet spends standing still,
// where nothing changes between two blinks. That is the one thing a desktop pet
// advertising "lightweight" cannot do.
framesRequested = 0;
timeoutDelays.length = 0;
frame(clock += 16);
assert.equal(framesRequested, 0, 'an idle pet must not ask for another frame');
assert.ok(timeoutDelays.at(-1) <= 1000,
  `the sleeping loop must arm its own backstop, armed ${timeoutDelays.at(-1)} ms`);

// A touch wakes it. The long press is noticed from a frame and the tap answer is
// drawn, so a press cannot wait for the backstop to come around.
framesRequested = 0;
canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
assert.ok(framesRequested > 0, 'pressing the pet must wake the sleeping loop');
windowEvents.get('mouseup')();
frame(clock += 20);

// …and a pet that is walking does keep drawing, or the gait would freeze mid-stride.
configChanged({ skin: 'bulu', petScale: 1, opacity: 1, autoMove: true, locale: 'zh' });
clock += 6000; // past nextWalk: the pet decides to go for a walk
frame(clock);
for (let i = 0; i < 3; i++) {
  framesRequested = 0;
  frame(clock += 16);
  assert.ok(framesRequested > 0, 'a walking pet must keep asking for frames');
}

// Walking back to rest hands the loop back to the idle path.
configChanged({ skin: 'bulu', petScale: 1, opacity: 1, autoMove: false, locale: 'zh' });
frame(clock += 4000); // the walk has run out: stopWalking()
framesRequested = 0;
frame(clock += 16);
assert.equal(framesRequested, 0, 'the pet stands still again once the walk is over');

for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 175, buttons: 0 });
}
assert.equal(speech.textContent, '好舒服呀～');
assert.equal(hearts.hidden, false);

// Regression: the pet is click-through unless the hit test finds its pixels. The
// backing store is 300*dpr while the hit test receives CSS coordinates, so the
// lookup has to be scaled — otherwise dragging and the right-click menu die on
// every display that is not at 100%.
assert.ok(hitSamples.length > 0, 'moving the pointer should hit-test the pet');
assert.ok(hitSamples.some(([x, y]) => x === 140 * 2 && y === 175 * 2),
  `hit test must read device pixels, got ${JSON.stringify(hitSamples.slice(0, 4))}`);

// Switching config.locale must swap the dictionary the pet speaks from.
clock += 3300; // clear the petting cooldown
locale = 'en';
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false, locale: 'en',
  standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true });
await new Promise(resolve => setImmediate(resolve));
for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 175, buttons: 0 });
}
assert.equal(speech.textContent, 'That feels nice~');
locale = 'zh';
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false, locale: 'zh',
  standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true });
await new Promise(resolve => setImmediate(resolve));
assert.equal(context.liteCurrentLocale(), 'zh');

// ---------- part-aware interaction ----------
// One tap answers from the region it landed on, a quick second tap is read as
// affection, and a hold that never becomes a drag makes the pet ask for mercy.
const config = (extra = {}) => {
  currentConfig = {
    skin: 'bulu', petScale: 1, opacity: 1, autoMove: false, locale: 'zh',
    standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true,
    fileDropReactions: true, ...extra,
  };
  configChanged(currentConfig);
};
const tap = (x, y) => {
  canvasEvents.get('mousedown')({ button: 0, offsetX: x, offsetY: y, screenX: 100, screenY: 100 });
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: y, screenX: 100, screenY: 100, buttons: 0 });
};
config();
clock += 400; // clear the petting cooldown and the double-tap window
tap(120, 175);
assert.equal(speech.textContent, '喵？叫我干嘛～', 'a tap on the head should answer as the head');
clock += 400;
tap(120, 270);
assert.equal(speech.textContent, '痒痒的，别戳啦～', 'a tap on the body should answer as the body');

clock += 400;
tap(120, 175);
clock += 100;
tap(120, 175);
assert.equal(speech.textContent, '嘿嘿，我也喜欢你！', 'two quick taps should be read as affection');
assert.equal(hearts.hidden, false, 'a double tap should show hearts');
assert.equal(browser.__boolooLiteState().action, 'wave', 'a double tap should wave');
frame(clock += 2600);

canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
frame(clock += 800);
assert.equal(speech.textContent, '摸够了吗…爪子都麻了', 'holding the pet should make it complain');
assert.equal(browser.__boolooLiteState().action, 'scratch', 'the hold reaction is the fifth pose row');
windowEvents.get('mouseup')();
frame(clock += 2600);

// Stroking the back is a different gesture from stroking the head: the pet
// settles down and grooms itself instead of just melting.
clock += 400;
for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 270, buttons: 0 });
}
assert.equal(speech.textContent, '呼噜噜……背上也舒服～', 'stroking the back should purr');
assert.equal(browser.__boolooLiteState().action, 'groom', 'a stroked back makes the pet groom');
frame(clock += 2600);

wallClock = 300_001;
intervals[0]();
await new Promise(resolve => setImmediate(resolve));
assert.ok(moves.length > 2, 'standing reminder should move through intermediate positions');
assert.deepEqual(moves.at(-1), [810, 294]);
assert.equal(speech.textContent, '老板，该站起来活动活动了！');

configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: true, standReminderMinutes: 7 });
const beforeCustom = moves.length;
wallClock += 6 * 60_000;
intervals[0]();
assert.equal(moves.length, beforeCustom, 'custom interval must wait the full duration');
wallClock += 60_001;
intervals[0]();
await new Promise(resolve => setImmediate(resolve));
assert.ok(moves.length > beforeCustom, 'custom interval should trigger a new reminder');

configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5 });
const moveCount = moves.length;
wallClock += 1_000_000;
intervals[0]();
assert.equal(moves.length, moveCount, 'disabled reminders should not move the pet');

speech.hidden = true;
frame(clock += 91_000);
assert.equal(dream.hidden, true, 'dream should wait until the pet settles to sleep');
frame(clock += 1300);
assert.equal(dream.hidden, false, 'sleeping pet should display a dream bubble');
assert.ok(dream.textContent, 'dream bubble should contain an icon');
canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 120, offsetY: 175, screenX: 100, screenY: 100, buttons: 0 });
frame(clock += 20);
assert.equal(dream.hidden, true, 'interaction should dismiss the dream bubble');

wallClock = 3_600_050;
intervals[0]();
assert.equal(speech.textContent, `现在是 ${new Date(wallClock).getHours()} 点啦～`);
const chimed = speechCount;
wallClock += 10_000;
intervals[0]();
assert.equal(speechCount, chimed, 'hourly announcement should happen once');
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: false });
wallClock = 7_200_050;
intervals[0]();
assert.equal(speechCount, chimed, 'disabled hourly announcement should stay silent');
configChanged({ skin: 'cat', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: true });
wallClock = 10_900_000;
intervals[0]();
assert.equal(speechCount, chimed, 'a missed hour after suspension should not announce late');

configChanged({ skin: 'bulu', petScale: 1, opacity: 1, autoMove: false,
  standReminderEnabled: false, standReminderMinutes: 5, hourlyChime: false });
actionReceived('wave');
frame(clock += 100);
assert.equal(lastDraw[3], 192, 'Bulu actions should use the dedicated action cell size');
frame(clock += 600);
// 700 ms into a 2100 ms clip lands on frame 5 of the 16-frame animation.
assert.equal(lastDraw[1], 5 * 192, 'wave should advance through its frames');
actionReceived('groom');
frame(clock += 1100);
assert.equal(lastDraw[2], 1 * 192, 'groom should use its own action row');
// The fifth action (scratch) lives on the last row of the atlas.
actionReceived('scratch');
frame(clock += 1100);
assert.equal(lastDraw[2], 4 * 192, 'scratch should use the fifth pose row');
actionReceived('unknown');
assert.equal(browser.__boolooLiteState().action, 'scratch', 'unknown actions should be ignored');
frame(clock += 2600);
assert.equal(browser.__boolooLiteState().action, null, 'action should return to normal playback');

canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 140, offsetY: 175, screenX: 126, screenY: 100, buttons: 1 });
transforms.length = 0;
frame(clock += 125);
assert.equal(lastDraw[2], 128, 'dragging should use the walking sprite row');
assert.equal(transforms.some(([x]) => x < 0), true, 'dragging right should mirror the left-facing walking art');
canvasEvents.get('mousemove')({ offsetX: 110, offsetY: 175, screenX: 96, screenY: 100, buttons: 1 });
transforms.length = 0;
frame(clock += 125);
assert.equal(transforms.some(([x]) => x < 0), false, 'dragging left should show the original walking art');
windowEvents.get('mouseup')();
canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 175, screenX: 100, screenY: 100 });
canvasEvents.get('mousemove')({ offsetX: 140, offsetY: 175, screenX: 126, screenY: 100, buttons: 1 });
transforms.length = 0;
frame(clock += 125);
assert.equal(transforms.some(([x]) => x < 0), true, 'the first rightward drag move must reset a previous left facing');

// An update is announced once per status change; the per-chunk download progress
// events must not re-trigger the bubble.
const update = (status, extra = {}) => updateState({ status, currentVersion: '0.6.5',
  autoCheck: true, autoDownload: true, channel: 'stable', ...extra });
update('available', { version: '0.9.0', autoDownload: false });
assert.equal(speech.textContent, '✨ 发现新版本 v0.9.0，去设置里就能下载～');
const announced = speechCount;
update('downloading', { version: '0.9.0', progress: { percent: 12, transferred: 1, total: 10, bytesPerSecond: 0 } });
update('downloading', { version: '0.9.0', progress: { percent: 64, transferred: 6, total: 10, bytesPerSecond: 0 } });
assert.equal(speechCount, announced, 'download progress must not repeat the bubble');
update('downloaded', { version: '0.9.0' });
assert.equal(speech.textContent, '✅ v0.9.0 已下载完成，重启后生效');

// ---------- the user's own reminders ----------
// A due reminder is taken out of the config and held up on the sign; one that
// came due while the machine was asleep is dropped without a word.
const tick = () => new Promise(resolve => setImmediate(resolve));
const quiet = { standReminderEnabled: false, hourlyChime: false };
// The drag test above left the pointer down; a pet being dragged is not free to
// walk over with a reminder until it is let go.
windowEvents.get('mouseup')();
config({ ...quiet, reminders: [{ id: 'r-due', text: '交周报', at: wallClock - 1000 }] });
intervals[0]();
await tick();
await tick();
assert.equal(sign.hidden, false, 'a due reminder should raise the sign');
assert.equal(sign.textContent, '⏰ 交周报');
// The counter batches land whenever they land, so look at the reminder patch
// itself rather than at whatever was written last.
assert.deepEqual(configPatches.filter(patch => patch.reminders).at(-1).reminders, [],
  'a fired reminder leaves the config');

frame(clock += 16);
tap(150, 175);
assert.equal(sign.hidden, true, 'touching the pet acknowledges the reminder');

config({ ...quiet, reminders: [{ id: 'r-stale', text: '昨天的蛋糕', at: wallClock - 3 * 60 * 60_000 }] });
intervals[0]();
await tick();
assert.deepEqual(configPatches.filter(patch => patch.reminders).at(-1).reminders, [],
  'a reminder missed by hours is dropped');
assert.equal(sign.hidden, true, 'a stale reminder is never announced');

// ---------- load awareness ----------
// One hot reading is noise; two in a row make the pet sweat. A nearly empty
// battery brings the badge and a nudge, and the charger wakes it up.
loadState = { available: true, cpu: 96, memory: 72, batteryPercent: 90, charging: true };
clock += 5000;
intervals[0]();
await tick();
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '💦', 'a pinned CPU should make the pet sweat');
assert.equal(mood.hidden, false, 'the sweat badge stays on screen while it is hot');
assert.equal(speech.textContent, '有点热…我歇一会儿');

loadState = { available: true, cpu: 10, memory: 40, batteryPercent: 12, charging: false };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '🪫', 'a low battery should switch the badge');
assert.equal(speech.textContent, '电量不多了，记得插电哦');

loadState = { available: true, cpu: 10, memory: 40, batteryPercent: 25, charging: true };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '⚡', 'plugging in should show the power badge');
assert.equal(speech.textContent, '来电啦！精神了 ⚡');

// A platform that cannot answer leaves the pet alone instead of guessing.
loadState = { available: false, cpu: null, memory: null, batteryPercent: null, charging: false };
clock += 5000;
intervals[0]();
await tick();
frame(clock += 16);
assert.equal(mood.textContent, '⚡', 'an unavailable reading must not clear the last badge on its own');

// ---------- daily counters behind the click heatmap ----------
// Taps are batched and merged into the config, so the settings panel's heatmap
// reads one growing bucket per local day.
config({ ...quiet });
const todayKey = dayKeyOf(wallClock);
clock += 400;
tap(120, 175);
clock += 6000; // past the 5 s batch window
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.clicks, 1,
  'a tap should be counted for today');
clock += 400;
tap(120, 175);
clock += 6000;
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.clicks, 2,
  'later taps add to the same day rather than replacing it');

// ---------- health plan ----------
// The standing reminder the pet already had, plus the look-away and water
// nudges: each keeps its own countdown and each counts towards today.
config({ ...quiet, standReminderEnabled: true, standReminderMinutes: 5 });
wallClock += 5 * 60_000 + 1000;
intervals[0]();
await tick();
await tick();
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.stand, 1,
  'standing up counts towards today');

config({ ...quiet, eyeRestEnabled: true, eyeRestMinutes: 20, waterEnabled: true, waterMinutes: 45 });
const beforeHealth = configPatches.length;
wallClock += 5 * 60_000;
intervals[0]();
assert.equal(configPatches.length, beforeHealth, 'the look-away nudge waits its full interval');
wallClock += 15 * 60_000 + 1000;
intervals[0]();
await tick();
assert.match(speech.textContent, /看会儿远处/, 'the look-away nudge should speak up');
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.eye, 1,
  'a delivered look-away nudge is counted');

wallClock += 25 * 60_000;
intervals[0]();
await tick();
assert.match(speech.textContent, /喝口水/, 'the water nudge should speak up');
intervals[0]();
await tick();
assert.equal(configPatches.at(-1).dailyStats?.[todayKey]?.water, 1,
  'a delivered water nudge is counted');

// Turning an item off means it never fires again, whatever the interval.
config({ ...quiet, eyeRestEnabled: false, eyeRestMinutes: 20, waterEnabled: false, waterMinutes: 45 });
speech.textContent = '';
const afterDisable = configPatches.length;
wallClock += 2 * 60 * 60_000;
intervals[0]();
await tick();
assert.equal(configPatches.length, afterDisable, 'disabled habits count nothing');
assert.equal(speech.textContent, '', 'disabled habits stay quiet');

// A custom interval — anything from 1 to 240 minutes, not just the presets the
// settings panel offers — is what actually drives the timer.
config({ ...quiet, eyeRestEnabled: true, eyeRestMinutes: 7 });
speech.textContent = '';
wallClock += 7 * 60_000 + 1000;
intervals[0]();
await tick();
assert.match(speech.textContent, /看会儿远处/, 'a custom look-away interval fires on its own schedule');

// ---------- affinity ----------
// Points come from touching the pet, the first hello of a day is worth extra,
// and one day is capped so the score cannot be ground out in an evening. The
// pet's running total is only ever raised, so these assertions are written as
// deltas against a total the test pins first.
config({ ...quiet, affinity: 190, statsDays: [], statsClicks: 0, statsFirstSeen: '' });
// Flush anything the earlier blocks left buffered, so this one starts from a
// known state: the pet's "already said hello today?" set is empty again.
clock += 6000;
intervals[0]();
await tick();
const clicksBefore = configPatches.filter(patch => patch.statsClicks !== undefined).at(-1).statsClicks;
speech.textContent = '';
for (let click = 0; click < 5; click++) {
  clock += 400; // keep the taps apart so they are not read as a double tap
  tap(120, 175);
}
clock += 6000;
intervals[0]();
await tick();
const afterLevelUp = configPatches.filter(patch => patch.affinity).at(-1);
assert.equal(afterLevelUp.affinity, 200,
  'five taps plus the first-hello bonus move the score from 190 to 200');
assert.match(speech.textContent, /好感度升级：Lv\.3 友好/, 'crossing a level says so');
assert.equal(afterLevelUp.statsClicks, clicksBefore + 5, 'the lifetime click count follows the taps');
assert.equal(afterLevelUp.affinityHistory.at(-1).value, 200, 'the growth history records the day');
assert.equal(afterLevelUp.statsDays.length, 1, 'and today counts as a day together');
assert.equal(afterLevelUp.statsFirstSeen.length, 10, 'the first day is remembered');
assert.equal(affinityChip.textContent, '+1 ❤️', 'every gain shows the little floating chip');
assert.equal(affinityChip.hidden, false, 'and it is on screen');

// Every further tap is worth one, until the day's 40 points are used up.
for (let click = 0; click < 4; click++) {
  clock += 400;
  tap(120, 175);
}
clock += 6000;
intervals[0]();
await tick();
const capped = configPatches.filter(patch => patch.affinity).at(-1);
assert.equal(capped.affinity, 204, 'four more taps are worth four points');

// Striking the pet is worth more than poking it.
clock += 4000;
for (const x of [110, 135, 115, 140]) {
  clock += 50;
  canvasEvents.get('mousemove')({ offsetX: x, offsetY: 270, buttons: 0 });
}
clock += 6000;
intervals[0]();
await tick();
assert.equal(configPatches.filter(patch => patch.affinity).at(-1).affinity, 207,
  'stroking the back is worth three');

// The cap holds even when the clicks keep coming: 45 taps in one day are worth
// 40 points and no more. `statsDays` already lists today, so no hello bonus.
const beforeCap = configPatches.filter(patch => patch.affinity).at(-1).affinity;
config({ ...quiet, affinity: 0, statsDays: [dayKeyOf(wallClock)], statsClicks: 0 });
for (let click = 0; click < 45; click++) {
  clock += 400;
  tap(120, 175);
}
clock += 6000;
intervals[0]();
await tick();
assert.equal(configPatches.filter(patch => patch.affinity).at(-1).affinity, beforeCap + 40,
  'one day stops at 40 points, however many taps arrive');

// ---------- feeding and the cat teaser ----------
// Hunger is the pet's own counter: it drifts up while the app runs, a treat takes
// it back down, and the tray is clicked where it is drawn. The wand pays
// affection per catch, and it must never capture the cursor on the way.
const careState = () => browser.__boolooLiteState().care;
const careHunger = () => browser.__boolooLiteState().hunger;
/** A left press, with the `preventDefault` the tray click handler calls. */
const careDown = (x, y) => canvasEvents.get('mousedown')({
  button: 0, offsetX: x, offsetY: y, screenX: 100, screenY: 100, preventDefault() {},
});
config({ ...quiet, dailyStats: {}, statsDays: [dayKeyOf(wallClock)], statsClicks: 0 });
windowEvents.get('mouseup')();
frame(clock += 16);

// Six hours of company: the meter fills up and the pet says so.
const hungerStart = careHunger();
clock += 6 * 60 * 60_000;
frame(clock);
assert.equal(careHunger(), 100, 'a long stretch between meals fills the hunger meter');
assert.ok(careHunger() > hungerStart, 'and it can only climb');
wallClock += 1000;
intervals[0]();
assert.equal(speech.textContent, '饿扁了…有吃的吗？', 'a starving pet asks for food');

// Right-click → 喂食… opens the tray above the pet's head.
careReceived('tray');
frame(clock += 16);
assert.equal(careState(), 'tray');
assert.equal(speech.textContent, '点一个喂给我吧～');
assert.equal(browser.__boolooHitTest(150, 48), true, 'the treat bubbles are clickable');

// Clicking the can eats it: 45 points off, the meal plays out, and the treat is
// paid for in affection once the chewing ends.
const affinityBeforeMeal = browser.__boolooLiteState().affinity;
careDown(150, 48);
assert.equal(careState(), 'eating', 'the click on the can starts a meal');
assert.equal(careHunger(), 55, 'the can takes 45 points off a full meter');
canvasEvents.get('mousemove')({ button: 0, offsetX: 150, offsetY: 48, screenX: 100, screenY: 100, buttons: 0 });
windowEvents.get('mouseup')();
clock += 6000;
intervals[0]();
await tick();
assert.equal(configPatches.filter(patch => patch.petStats).at(-1).petStats.hunger, 55,
  'the hunger the pet drifted and the meal changed is written back to the config');
assert.equal(configPatches.filter(patch => patch.petStats).at(-1).petStats.mood, 78,
  'a can is also worth eight points of mood');
frame(clock += 2500);
assert.equal(careState(), null, 'the meal is over');
assert.equal(browser.__boolooLiteState().affinity, affinityBeforeMeal + 2, 'the can is worth two points');
assert.equal(hearts.hidden, false, 'a finished meal makes the pet happy');
assert.equal(speech.textContent, '罐头！今天是大餐 🥫');

// Settings feeds through the same relay, and a pet that has just eaten refuses
// the next treat instead of eating indefinitely.
careReceived('feed:can');
assert.equal(careState(), 'eating');
assert.equal(careHunger(), 10);
frame(clock += 2500);
careReceived('feed:fish');
frame(clock += 16);
assert.equal(careState(), null, 'a full pet does not start another meal');
assert.equal(careHunger(), 10, 'and the refused treat changes nothing');
assert.equal(speech.textContent, '我刚吃饱啦，先存着好不好～');

// The cat teaser: the wand swings over the pet, the pet lunges, and each catch
// is worth a point.
careReceived('toy');
frame(clock += 16);
assert.equal(careState(), 'toy');
assert.equal(speech.textContent, '陪我玩一会儿逗猫棒！再点我一下就收起来～');
// The wand lives on the same canvas as the pet, so it is part of the hit test by
// default — it has to be carved out or the window swallows desktop clicks.
const wandHead = context.careToySwing(16);
assert.equal(browser.__boolooHitTest(wandHead.x, wandHead.y), false,
  'the wand must stay click-through');
assert.equal(browser.__boolooHitTest(150, 175), true, 'the pet itself is still clickable');

const affectionBeforeCatch = browser.__boolooLiteState().affinity;
clock += 1000;
frame(clock);
assert.equal(browser.__boolooLiteState().action, 'wave', 'the first lunge swats with a paw');
clock += 800;
frame(clock);
assert.equal(browser.__boolooLiteState().affinity, affectionBeforeCatch + 1, 'a catch is worth one point');
assert.equal(speech.textContent, '抓到了！');

// Touching the pet stops the session, with a summary of how it went.
careDown(150, 175);
canvasEvents.get('mousemove')({ button: 0, offsetX: 150, offsetY: 175, screenX: 100, screenY: 100, buttons: 0 });
windowEvents.get('mouseup')();
assert.equal(careState(), null, 'a tap ends the play session');
assert.equal(speech.textContent, '玩够啦，谢谢陪我～ 抓到 1 次');

console.log('Petting, taps, holds, blinking, affinity, reminders, load reactions, daily ' +
  'counters, health plan, dreams, actions, language switch, update notice, feeding and ' +
  'the cat teaser: passed');

// ---------- throwing the pet ----------
// A drag that ends fast becomes a flight the window drives itself: it keeps moving
// after the button is up, bounces off the work-area edge Rust reported and stops on
// its own once the friction has eaten the speed. The drag itself is native
// (drag_begin / drag_move), so what is asserted here is everything after the release.
const throwDown = (x, y) => canvasEvents.get('mousedown')({ button: 0, offsetX: 120, offsetY: 200, screenX: x, screenY: y, preventDefault() {} });
const throwMove = (x, y, buttons = 1) => canvasEvents.get('mousemove')({ button: 0, offsetX: 120, offsetY: 200, screenX: x, screenY: y, buttons });
const throwFrames = (count, step = 16) => { for (let i = 0; i < count; i++) frame(clock += step); };

const beforeThrow = moves.length;
throwDown(400, 400);
clock += 10; throwMove(412, 400);
clock += 10; throwMove(424, 400);
clock += 10; throwMove(436, 400);
// Released while still moving: the last sample counts, and the pet flies.
throwMove(448, 400, 0);
await tick();                       // the launch reads the window position back
const launched = moves.length - beforeThrow;
frame(clock += 16);
const afterOneFrame = moves.length - beforeThrow;
assert.ok(afterOneFrame > launched, 'a throw moves the window with no mouse held');
const thrownXs = moves.slice(beforeThrow).map(([x]) => x);
assert.ok(thrownXs.some(x => x > 100), `the pet travels after the release (${thrownXs.join(',')})`);
assert.ok(thrownXs.every(x => x >= -100 && x <= 1720), 'and never leaves the work area');
// In the air it plays its own strip — a four-frame flail, not the walking row, which
// is what stops a thrown pet from looking like it is taking a stroll in mid-air.
assert.ok(lastDraw[0]._src?.includes('bulu-airborne'), `a flying pet draws the airborne strip, got ${lastDraw[0]._src}`);
assert.equal(lastDraw[2], 0, 'whose single row starts at y=0');
assert.ok(lastDraw[1] % 128 === 0 && lastDraw[1] < 128 * 4, `and one of its four frames, got x=${lastDraw[1]}`);

// The flight ends by itself — no timer, the friction runs out.
throwFrames(400);
const settledAt = moves.length;
throwFrames(30);
assert.equal(moves.length, settledAt, 'the flight has to come to rest on its own');
assert.ok(moves.slice(beforeThrow).length > 20, 'and it was a real flight, not one hop');

// A slow drag is a placement: the pet stays where it was dropped.
const beforePlace = moves.length;
throwDown(400, 400);
clock += 100; throwMove(410, 400);   // >5 px, so this really is a drag
clock += 100; throwMove(412, 400, 0); // 12 px over 100 ms = a slow placement
await tick();
throwFrames(10);
assert.equal(moves.length, beforePlace, 'putting the pet down must not throw it');

// The complaint this judgement was rewritten for: drag it quickly, stop, let go. The
// release is sampled from the mouse-up itself, so the hand's last 80 ms of stillness
// is visible to the model and the pet stays exactly where it was dropped.
const beforeHeldRelease = moves.length;
throwDown(400, 400);
clock += 10; throwMove(440, 400);      // a fast drag…
clock += 10; throwMove(480, 400);
clock += 80;                           // …that comes to a stop before the release
windowEvents.get('mouseup')({ screenX: 480, screenY: 400 });
await tick();
throwFrames(10);
assert.equal(moves.length, beforeHeldRelease, 'drag, stop, release must not throw the pet');

// …but a flick whose hand has already begun to slow down still throws: the *gesture*
// has to look like a throw, the release only has to be moving. Demanding full speed at
// the release made a normal "swipe and let go" do nothing at all.
const beforeSlowTail = moves.length;
throwDown(400, 400);
clock += 10; throwMove(430, 400);      // ~3000 px/s
clock += 10; throwMove(470, 400);      // ~4000 px/s
clock += 16; throwMove(474, 400, 0);   // 4 px in 16 ms ≈ 250 px/s when it lets go
await tick();
throwFrames(6);
assert.ok(moves.length > beforeSlowTail, 'a flick that is still moving at release must fly');

// A mouse that reports every millisecond — a gaming mouse — has to be able to throw the
// pet as well. The release used to be judged between the last two events, where a single
// pixel of movement is 1000 px/s of apparent jitter and the old 2 px floor demanded
// 2000 px/s: the pet was throwable below 125 Hz and impossible above it.
const beforeFineMouse = moves.length;
throwDown(400, 400);
for (let i = 1; i <= 40; i++) {
  clock += 1;
  throwMove(400 + Math.round(i * 0.7), 400);  // 700 px/s at one event per millisecond
}
clock += 1;
throwMove(428, 400, 0);
await tick();
throwFrames(6);
assert.ok(moves.length > beforeFineMouse, 'a 1000 Hz mouse can throw the pet');

// Catching a pet in mid-air ends the flight where it was caught. (No `hit` check on
// the rotated pose: the press lands on the pet's own box, as it does for any drag.)
throwDown(400, 400);
clock += 10; throwMove(440, 400);
clock += 10; throwMove(480, 400, 0);
await tick();
throwFrames(3);
const caughtAt = moves.length;
throwDown(400, 400);
throwFrames(6);
assert.equal(moves.length, caughtAt, 'grabbing a flying pet stops it');
windowEvents.get('mouseup')();

console.log('Thrown pet: launch, bounce off the work area, friction stop, catch: passed');
