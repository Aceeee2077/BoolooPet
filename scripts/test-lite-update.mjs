// ============================================================================
// Drives the Settings update panel against a fake DOM. The interesting part of
// the feature is the state machine (idle → checking → available → downloading →
// downloaded) and the buttons / progress bar it drives, which no Rust test can
// see. The backend side is covered by the app self-check (real window, real
// `update_get_state`).
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));

const RELEASES = 'https://github.com/Aceeee2077/BoolooPet/releases/latest';
const events = new Map();
const elements = new Map();
const calls = {
  getState: 0, check: 0, download: 0, install: 0, openPage: 0,
  patches: [], care: [], petList: 0, petExport: [], petRemove: [],
};
/** Installed pet packs the harness pretends are on disk. */
const pets = [{
  id: 'demo', displayName: '小恐龙', author: 'someone', version: '1.2.0',
  dir: 'C:\\pets\\demo', spritesheet: 'C:\\pets\\demo\\sheet.png', url: 'data:image/png;base64,AA',
  manifest: {
    id: 'demo', displayName: '小恐龙', source: 'imported', schemaVersion: 1,
    assets: { spritesheet: 'sheet.png' },
    sprite: { frameWidth: 32, frameHeight: 32, columns: 4, rows: 2, scale: 1 },
    animations: { idle: { frames: [0, 1], fps: 8, loop: true } },
  },
}];
let locale = 'zh';
let updateState = () => {};
let configChanged = () => {};
let pendingCheck = null;

function makeElement(id) {
  const element = {
    id, value: '', checked: false, disabled: false, hidden: false, title: '',
    // The language chips are positioned by a custom property, so the stub has to
    // accept setProperty the way a real style declaration does.
    style: { setProperty(name, value) { this[name] = value; } },
    dataset: {}, attributes: {},
    focus() { this.focused = true; }, select() { this.selected = true; },
    append(...nodes) { this.children = (this.children || []).concat(nodes); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    classList: { err: false, toggle(name, on) { if (name === 'err') this.err = !!on; }, add(name) { if (name === 'err') this.err = true; }, remove() {}, contains: () => false },
    addEventListener(name, callback) { events.set(`${id}:${name}`, callback); },
    querySelectorAll: () => [],
  };
  // Setting textContent replaces the children in a real DOM; the heatmap and the
  // reminder list both rely on that to clear themselves before a repaint.
  let text = '';
  Object.defineProperty(element, 'textContent', {
    get: () => text,
    set: (value) => { text = value; element.children = []; },
  });
  return element;
}
const element = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};

const config = {
  skin: 'cat', currentPetId: 'cat', locale: 'zh', petScale: 1, opacity: 1, autoMove: false,
  fileDropReactions: true, standReminderEnabled: true, standReminderMinutes: 5, hourlyChime: true,
  autoLaunch: false, updateAutoCheck: true, updateAutoDownload: true, updateChannel: 'stable',
};
const api = {
  getI18n: async () => ({ locale, dict: locale === 'en' ? enDict : zhDict }),
  getConfig: async () => config,
  setConfig: async (patch) => {
    calls.patches.push(patch);
    Object.assign(config, patch);
    queueMicrotask(() => configChanged({ ...config }));
    return { ...config };
  },
  autoLaunchGet: async () => false,
  autoLaunchSet: async () => false,
  onConfigChanged: (callback) => { configChanged = callback; },
  onSettingsFocusSection: () => {},
  onCustomImageChanged: () => {},
  onUpdateState: (callback) => { updateState = callback; },
  updateGetState: async () => {
    calls.getState++;
    return { status: 'idle', currentVersion: '0.6.5', manualUrl: RELEASES, autoCheck: true, autoDownload: true, channel: 'stable' };
  },
  updateCheck: async () => {
    calls.check++;
    // Held open so the test can observe the in-flight button state.
    return new Promise(resolve => { pendingCheck = resolve; });
  },
  updateDownload: async () => {
    calls.download++;
    return { status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
      autoCheck: true, autoDownload: false, channel: 'stable' };
  },
  updateInstall: async () => { calls.install++; },
  care: (action) => { calls.care.push(action); },
  // The installed pet packs are a directory listing rather than a config value.
  petList: async () => {
    calls.petList++;
    return { ok: true, pets: pets };
  },
  petImport: async () => ({ ok: false, cancelled: true }),
  petExport: async (id) => { calls.petExport.push(id); return { ok: true, path: `D:\\share\\${id}` }; },
  petRemove: async (id) => { calls.petRemove.push(id); return { ok: true }; },
  closeSettings: () => {},
  openProjectPage: () => { calls.openPage++; },
};

const browser = {
  api,
  addEventListener() {},
  setTimeout: (callback) => { queueMicrotask(callback); return 1; },
  clearTimeout() {},
};
const context = {
  window: browser,
  document: {
    documentElement: {},
    getElementById: element,
    createElement: (tag) => makeElement(tag),
    querySelectorAll: (selector) => (selector === '#skins button' ? [] : []),
  },
  Math, Number, String, Promise, Error, Array, console,
};
vm.createContext(context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-i18n.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-day.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-affinity.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-achievements.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-care.js'), 'utf8'), context);
// The weekly summary is built from the same per-day buckets the heatmap draws.
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-summary.js'), 'utf8'), context);
// The year report reads those buckets a year at a time, and the settings script
// paints it alongside the week.
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-report.js'), 'utf8'), context);
vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', 'lite-settings.js'), 'utf8'), context);
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
await settle();

const version = element('update-version');
const status = element('update-status');
const progressRow = element('update-progress-row');
const progressBar = element('update-progress-bar');
const progressText = element('update-progress-text');
const notesBox = element('update-notes-box');
const manual = element('update-manual');
const checkButton = element('btn-check-update');
const downloadButton = element('btn-download-update');
const installButton = element('btn-install-update');
const click = (id) => events.get(`${id}:click`)();
const change = (id) => events.get(`${id}:change`)();

// Opening Settings shows the running version and an honest "not checked yet".
assert.equal(calls.getState, 1, 'the panel asks for a snapshot on open');
assert.equal(version.textContent, 'v0.6.5');
assert.equal(status.textContent, '尚未检查');
assert.equal(downloadButton.hidden, true, 'no download button before a check');
assert.equal(installButton.hidden, true);
assert.equal(progressRow.hidden, true);

// Choosing Custom must leave its number editor open. A premature save of the
// old 5-minute value broadcasts a config repaint that hides the editor.
const interval = element('stand-interval');
const customMinutes = element('stand-custom');
const customLabel = element('stand-custom-label');
interval.value = 'custom';
change('stand-interval');
await settle();
assert.equal(customLabel.hidden, false);
assert.equal(customMinutes.focused, true);
assert.equal(calls.patches.length, 0, 'selecting Custom must wait for a new value');
customMinutes.value = '7';
change('stand-custom');
await settle();
assert.equal(calls.patches.at(-1).standReminderMinutes, 7);
assert.equal(interval.value, 'custom');
calls.patches.length = 0;

// Checking offers the new version, its release notes and a download button
// (auto-download is off in this snapshot).
click('btn-check-update');
assert.equal(checkButton.disabled, true, 'no second check while one is in flight');
pendingCheck({ status: 'available', currentVersion: '0.6.5', version: '0.6.6', notes: '· 修复了若干问题',
  manualUrl: RELEASES, autoCheck: true, autoDownload: false, channel: 'stable' });
await settle();
assert.equal(calls.check, 1);
assert.equal(status.textContent, '发现新版本 v0.6.6');
assert.equal(downloadButton.hidden, false);
assert.equal(notesBox.hidden, false);
assert.equal(element('update-notes').textContent, '· 修复了若干问题');
assert.equal(checkButton.disabled, false, 'the button comes back once the check answered');

// Downloading drives the progress bar from the pushed events.
updateState({ status: 'downloading', currentVersion: '0.6.5', version: '0.6.6',
  progress: { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 0 },
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(progressRow.hidden, false);
assert.equal(progressBar.style.width, '42%');
assert.equal(progressText.textContent, '42%');
assert.equal(status.textContent, '正在下载… 42%');

// The finished download swaps the download button for the restart button.
updateState({ status: 'downloaded', currentVersion: '0.6.5', version: '0.6.6',
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(progressRow.hidden, true);
assert.equal(downloadButton.hidden, true);
assert.equal(installButton.hidden, false);
assert.equal(status.textContent, 'v0.6.6 已就绪');
click('btn-install-update');
await settle();
assert.equal(calls.install, 1, 'the restart button installs the downloaded update');

// A manual download button appears when auto-download is off, and it asks the
// backend for the same download the background path would have started.
updateState({ status: 'available', currentVersion: '0.6.5', version: '0.6.6',
  autoCheck: true, autoDownload: false, channel: 'stable' });
assert.equal(downloadButton.hidden, false);
click('btn-download-update');
await settle();
assert.equal(calls.download, 1);

// Builds that cannot update themselves still point at the release page.
updateState({ status: 'unsupported', currentVersion: '0.6.5', manualUrl: RELEASES,
  autoCheck: true, autoDownload: true, channel: 'stable' });
assert.equal(manual.hidden, false);
assert.match(manual.textContent, /BoolooPet\/releases\/latest/);
assert.equal(checkButton.disabled, true, 'an unsupported build cannot check');
assert.equal(status.textContent, '当前版本无法自动更新，请手动下载新版本');

// The preference toggles persist through config.
element('update-auto-check').checked = false;
change('update-auto-check');
element('update-auto-download').checked = false;
change('update-auto-download');
await settle();
// The patches are built inside the VM realm, so compare their shape, not their
// prototype.
assert.deepEqual(JSON.parse(JSON.stringify(calls.patches)),
  [{ updateAutoCheck: false }, { updateAutoDownload: false }]);

// A language switch re-translates the status line built from the dictionary.
locale = 'en';
configChanged({ ...config, locale: 'en' });
await settle();
assert.equal(status.textContent, 'This build cannot update itself — download new versions manually');

console.log('Settings update panel: status machine, progress and preferences: passed');

// ---------- click heatmap ----------
// One whole calendar year: every day from January 1st to December 31st is on the
// grid, days still to come stay blank, and today's square is marked. The
// thresholds are the ones asked for — 10 clicks is the first shade, 100 the last.
// The panel was switched to English above; the strings below are asserted in
// Chinese, so put it back and let the dictionary reload finish.
locale = 'zh';
configChanged({ ...config, locale: 'zh' });
await settle();
const grid = element('heatmap-grid');
const now = new Date();
const year = now.getFullYear();
const pad2 = (value) => String(value).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const todayKey = keyOf(now);
const first = new Date(year, 0, 1);
const last = new Date(year, 11, 31);
const dayOf = (date) => Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - first) / 86_400_000);
const lead = (first.getDay() + 6) % 7; // 0 = Monday
const columns = Math.ceil((lead + dayOf(last) + 1) / 7);
const cellAt = (dayIndex) => {
  const column = 1 + Math.floor((lead + dayIndex) / 7);
  const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + dayIndex);
  const row = (date.getDay() + 6) % 7;
  return element('heatmap-grid').children[(row + 1) * (columns + 1) + column];
};
const levelOf = (clicks) => {
  config.dailyStats = clicks === null ? {} : { [todayKey]: { clicks } };
  configChanged({ ...config });
  return cellAt(dayOf(now)).attributes['data-level'];
};
assert.equal(grid.children.length, (columns + 1) * 8,
  `the grid should cover the whole of ${year} (${columns} weeks) plus the labels`);
assert.equal(levelOf(null), '0', 'a day without clicks is drawn as empty');
assert.equal(levelOf(9), '0', '9 clicks is still below the first shade');
assert.equal(levelOf(10), '1', '10 clicks is the lightest shade');
assert.equal(levelOf(45), '2');
assert.equal(levelOf(80), '3');
assert.equal(levelOf(100), '4', '100 clicks and up is the darkest shade');
assert.equal(levelOf(400), '4');
assert.equal(cellAt(dayOf(now)).attributes['data-today'], '1', 'today is the outlined square');
levelOf(45);
assert.match(element('heatmap-summary').textContent, /45/, 'the summary totals the shown year');
assert.match(cellAt(dayOf(now)).title, /45/, 'a day cell carries its real count in the tooltip');
levelOf(null);
assert.match(element('heatmap-summary').textContent, /还没有记录/, 'an empty year says so');

// ---------- weekly summary ----------
// The report reads the very same per-day buckets the grid above was just drawn
// from, so the two can never disagree and the pet records nothing extra for it.
config.dailyStats = {
  [todayKey]: { clicks: 45, stand: 2, eye: 1, water: 1, affinity: 12 },
};
configChanged({ ...config });
await settle();
assert.equal(element('summary-clicks').textContent, '45');
assert.equal(element('summary-days').textContent, '1', 'one day was spent together');
assert.equal(element('summary-stand').textContent, '2');
assert.equal(element('summary-eye').textContent, '1');
assert.equal(element('summary-water').textContent, '1');
assert.equal(element('summary-affinity').textContent, '+12', 'the week reports the affection it earned');
assert.match(element('summary-line').textContent, /陪伴/, 'and it says something about the week');
assert.match(element('summary-range').textContent, /–|~/u, 'the range is printed as a range');
// A day the pet was not running is absent rather than a zero.
config.dailyStats = {};
configChanged({ ...config });
await settle();
assert.equal(element('summary-clicks').textContent, '0');
assert.equal(element('summary-days').textContent, '0');
assert.match(element('summary-line').textContent, /睡觉/, 'an empty week reads as a quiet one');
console.log('Weekly summary panel: totals, quiet week and range: passed');

// The rest of the year is on the grid too: later days are drawn as empty squares
// that say "not yet", and the padding that belongs to the neighbouring year is
// not drawn as days at all.
const tomorrow = new Date(year, now.getMonth(), now.getDate() + 1);
if (tomorrow.getFullYear() === year) {
  const cell = cellAt(dayOf(tomorrow));
  assert.equal(cell.attributes['data-level'], '0', 'a day still to come is drawn as an empty square');
  assert.match(cell.title, /还没到/, 'and says it has not arrived yet');
}
if (lead > 0) {
  const padding = element('heatmap-grid').children[1 * (columns + 1) + 1];
  assert.equal(padding.attributes['data-level'], '-2', 'days before January 1st are not drawn');
}

// The arrows step the year, and never past the current one.
const yearLabel = element('heatmap-year');
assert.equal(yearLabel.textContent, String(year));
assert.equal(element('heatmap-next').disabled, true, 'the future has no year to show');
click('heatmap-prev');
assert.equal(yearLabel.textContent, String(year - 1), 'the back arrow steps a year');
assert.equal(element('heatmap-next').disabled, false);
click('heatmap-next');
assert.equal(yearLabel.textContent, String(year));

console.log('Click heatmap shading, summary and empty state: passed');

// ---------- health plan intervals ----------
// Presets plus "custom", the same contract the standing reminder has: picking
// custom only opens the number field, and the value is written when that field
// changes — saving on the select's own change would write the old preset back.
element('eye-interval').value = 'custom';
change('eye-interval');
await settle();
assert.equal(element('eye-custom-label').hidden, false, 'custom reveals the look-away minutes field');
assert.equal(element('eye-custom').focused, true, 'and focuses it');
calls.patches.length = 0;
element('eye-custom').value = '25';
change('eye-custom');
await settle();
assert.equal(calls.patches.at(-1).eyeRestMinutes, 25, 'a custom look-away interval is saved');
assert.equal(element('eye-interval').value, 'custom', 'and comes back as custom');
assert.equal(element('eye-custom').value, '25');

element('water-interval').value = 'custom';
change('water-interval');
await settle();
assert.equal(element('water-custom-label').hidden, false, 'custom reveals the water minutes field');
calls.patches.length = 0;
element('water-custom').value = '75';
change('water-custom');
await settle();
assert.equal(calls.patches.at(-1).waterMinutes, 75, 'a custom water interval is saved');

// Out-of-range input is refused rather than silently replaced by the default.
element('eye-custom').value = '999';
calls.patches.length = 0;
change('eye-custom');
await settle();
assert.equal(calls.patches.length, 0, 'an out-of-range interval is not written');
assert.match(element('health-status').textContent, /1～240/, 'and the panel says why');

// A stored value that is no preset is shown as custom with its number.
config.eyeRestMinutes = 45;
configChanged({ ...config });
await settle();
assert.equal(element('eye-interval').value, 'custom');
assert.equal(element('eye-custom').value, '45');
assert.equal(element('eye-custom-label').hidden, false);

console.log('Health plan intervals: presets and custom minutes: passed');

// ---------- affinity ----------
// The panel shows the level name, the score, the bar towards the next level and
// the three lifetime numbers, all read from the config the pet writes.
config.affinity = 260;
config.statsDays = ['2026-09-01', '2026-09-02', '2026-09-03'];
config.statsFirstSeen = '2026-09-01';
config.statsClicks = 123;
configChanged({ ...config });
await settle();
assert.equal(element('affinity-level').textContent, '友好', '260 points is the third level');
assert.equal(element('affinity-value').textContent, '260');
assert.equal(element('affinity-fill').style.width, '20%', '260 is a fifth of the way from 200 to 500');
assert.match(element('affinity-next').textContent, /240/, 'and the panel says what is left');
assert.equal(element('affinity-days').textContent, '3');
assert.equal(element('affinity-first').textContent, '2026-09-01');
assert.equal(element('affinity-clicks').textContent, '123');

config.affinity = 1200;
configChanged({ ...config });
await settle();
assert.equal(element('affinity-level').textContent, '挚友', 'the last level is the ceiling');
assert.equal(element('affinity-fill').style.width, '100%');
assert.match(element('affinity-next').textContent, /最高等级/, 'and there is nothing left to earn');

console.log('Affinity panel: level, bar, next level and lifetime stats: passed');

// ---------- treats ----------
// Settings → 投喂 is built from the same food table the pet window uses: three
// buttons labelled from the dictionary, a meter driven by `config.petStats`, and
// a click that asks the pet window (through `care`) to eat it.
const treatButtons = element('care-foods').children;
assert.equal(treatButtons.length, 3, 'one button per food in CARE_FOODS');
assert.equal(treatButtons[0].children[1].textContent, zhDict['lite.care.food.fish']);
assert.equal(treatButtons[2].children[1].textContent, zhDict['lite.care.food.milk']);
// The config carries no petStats yet, so the meter shows the documented default.
assert.equal(element('care-fill').style.width, '20%');
assert.match(element('care-status').textContent, /20/, 'the status line prints the meter');
// The harness gives every created element the same fake id, so the listener it
// kept is the last treat's — enough to prove the relay reaches `api.care`.
events.get('button:click')();
assert.deepEqual(calls.care, ['feed:milk'], 'the button asks the pet window to eat that treat');
assert.match(element('care-message').textContent, /牛奶/);
console.log('Treat section: meter, buttons and the feeding relay: passed');

// The title bar's GitHub button opens the repository in the default browser; the
// URL itself lives in src-tauri/src/opener.rs, so the page only has to ask.
click('open-github');
assert.equal(calls.openPage, 1, 'clicking the GitHub button opens the project page');

console.log('GitHub button in the settings title bar: passed');

// ---------- pet packs ----------
// An imported character is a whole folder — a manifest plus a sheet — so the panel
// lists it, and every action goes through the backend rather than the config.
const packList = element('packs');
assert.equal(calls.petList, 1, 'the panel lists the installed packs on open');
assert.equal(packList.children.length, 1, 'one card per installed pack');
const packCard = packList.children[0];
assert.equal(packCard.dataset.packId, 'demo');
assert.equal(packCard.children[0].textContent, '小恐龙');
assert.equal(packCard.children[1].textContent, 'someone · 1.2.0');
const [useButton, exportButton, deleteButton] = packCard.children.slice(2);
assert.equal(useButton.textContent, zhDict['lite.pack.use']);
assert.equal(exportButton.textContent, zhDict['lite.pack.export']);
assert.equal(deleteButton.textContent, zhDict['lite.pack.remove']);
// "Edit…" trails the three actions the card has always carried, so the earlier
// slice still reads the first three in order.
assert.equal(packCard.children[5].dataset.packAction, 'edit');
assert.equal(packCard.children[5].textContent, zhDict['lite.editor.edit']);

// "Use" is the same config write the skin buttons make, so the pet window picks
// the pack up through the ordinary config broadcast.
const cardStub = { dataset: { packId: 'demo' } };
const packButton = (action) => ({
  dataset: { packAction: action },
  closest: (selector) => (selector === '[data-pack-id]' ? cardStub : null),
});
const clickPack = (action) => events.get('packs:click')({ target: { closest: () => packButton(action) } });
clickPack('use');
await settle();
// The patch is built inside the VM realm, so compare its shape, not its prototype.
assert.deepEqual(JSON.parse(JSON.stringify(calls.patches.at(-1))), { skin: 'pack', currentPetId: 'demo' });
clickPack('export');
await settle();
assert.deepEqual(calls.petExport, ['demo'], 'export goes through the backend');
assert.match(element('pack-status').textContent, /demo/, 'and reports where the copy landed');
clickPack('remove');
await settle();
assert.deepEqual(calls.petRemove, ['demo']);
assert.equal(calls.petList, 2, 'deleting re-lists the installed packs');
assert.match(element('pack-status').textContent, /小恐龙/, 'and says which pack went');
// The editor script is loaded on the real page but not here: the optional call
// has to degrade to a no-op rather than throw.
clickPack('edit');
await settle();
assert.match(element('pack-status').textContent, /小恐龙/, 'a missing editor is skipped, not fatal');
console.log('Pet pack section: cards, use / export / delete: passed');
