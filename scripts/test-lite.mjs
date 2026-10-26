import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
// The renderer translates through the dictionary the backend hands it, so the
// tests build the same translations from the compiled src/shared/i18n.ts.
const { zhDict, enDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));
// Rebranding must keep the existing data directory and signed update channel.
const appConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'));
assert.equal(appConfig.productName, 'Booloo');
assert.equal(appConfig.identifier, 'com.petric.desktop-pet');
// Tauri expects the base64-encoded .pub file, rather than the inner key alone.
// Use the original identity so signed releases remain compatible with v0.5.1.
const publicKeyLines = Buffer.from(appConfig.plugins.updater.pubkey, 'base64')
  .toString('utf8').trim().split(/\r?\n/);
assert.equal(publicKeyLines.length, 2);
assert.match(publicKeyLines[0], /^untrusted comment:/);
assert.equal(publicKeyLines[1], 'RWT/YsdfZNqBA9Eq8QCWELWxQOvRJ267u5oFFmhcAaVVNBeNUfMefo7J');
assert.equal(Buffer.from(publicKeyLines[1], 'base64').length, 42);
// Windows upgrades must find the previous installation despite its display name.
const installer = readFileSync(join(process.cwd(), 'src-tauri', appConfig.bundle.windows.nsis.template), 'utf8');
assert.ok(installer.includes('!define UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Prismoo"'));
assert.ok(installer.includes('!define MANUPRODUCTKEY "Software\\Prismoo\\Prismoo"'));
assert.deepEqual(appConfig.plugins.updater.endpoints,
  ['https://github.com/Aceeee2077/BoolooPet/releases/latest/download/latest.json']);
assert.equal(zhDict['bubble.greeting'], '喵～ 我是布噜！');
assert.equal(enDict['bubble.greeting'], "Meow~ I'm Bulu!");
const makeTranslate = (dict) => (key, params) => {
  const value = dict[key];
  if (typeof value !== 'string') return key;
  return params ? value.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? '')) : value;
};

const source = readFileSync(join(process.cwd(), 'src/renderer/lite-image.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
let raster = new Uint8ClampedArray();
const context = {
  document: { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(raster) }),
      putImageData: ({ data }) => { raster = new Uint8ClampedArray(data); },
    }),
  }) },
  Uint8Array, Int32Array, Uint8ClampedArray, Math, Error,
  liteT: makeTranslate(zhDict),
};
vm.createContext(context);
vm.runInContext(js, context);

const image = { naturalWidth: 100, naturalHeight: 100 };
const pixel = (x, y, rgb, alpha = 255) => {
  const offset = (y * 100 + x) * 4;
  raster.set([rgb[0], rgb[1], rgb[2], alpha], offset);
};
const fill = (rgb, alpha = 255) => {
  raster = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) pixel(x, y, rgb, alpha);
};

// The renderer no longer keys anything: the automatic cutout is one Rust pass
// (custom.rs), so this only draws the picture, measures what is visible and
// guards the picture that would render as an empty canvas.
fill([255, 255, 255]);
for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) pixel(x, y, [220, 90, 110]);
let result = context.litePrepareImage(image);
assert.equal(result.visiblePixels, 10000, 'nothing is keyed in the renderer any more');
assert.deepEqual(JSON.parse(JSON.stringify(result.bounds)), { x: 0, y: 0, width: 100, height: 100 });

fill([0, 0, 0], 0);
for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) pixel(x, y, [40, 50, 60]);
result = context.litePrepareImage(image);
assert.equal(result.visiblePixels, 3600);
assert.deepEqual(JSON.parse(JSON.stringify(result.bounds)), { x: 20, y: 20, width: 60, height: 60 });

fill([0, 0, 0], 0);
assert.throws(() => context.litePrepareImage(image), /完全透明/);
// Same failure, English dictionary: the messages follow config.locale.
context.liteT = makeTranslate(enDict);
assert.throws(() => context.litePrepareImage(image), /fully transparent/);
context.liteT = makeTranslate(zhDict);

const renderer = join(process.cwd(), 'dist', 'renderer');
const shippedScripts = readdirSync(renderer).filter(name => name.endsWith('.js')).sort();
assert.deepEqual(shippedScripts, ['lite-achievements.js', 'lite-affinity.js', 'lite-api.js', 'lite-app.js', 'lite-care.js',
  'lite-day.js', 'lite-file-reaction.js', 'lite-gait.js', 'lite-i18n.js', 'lite-image.js', 'lite-mask.js', 'lite-menu.js',
  'lite-pack-editor.js', 'lite-pack.js', 'lite-pet-outline.js', 'lite-pet-timing.js', 'lite-report.js', 'lite-settings.js',
  'lite-summary.js', 'lite-throw.js']);
const fileReaction = { liteT: makeTranslate(zhDict) };
vm.createContext(fileReaction);
vm.runInContext(readFileSync(join(renderer, 'lite-file-reaction.js'), 'utf8'), fileReaction);
assert.match(fileReaction.liteFileReaction(['C:\\work\\cat.PNG']), /照片/);
assert.match(fileReaction.liteFileReaction(['/tmp/report.pdf']), /工作/);
assert.match(fileReaction.liteFileReaction(['/tmp/archive.zip']), /礼物/);
assert.match(fileReaction.liteFileReaction(['/tmp/song.mp3']), /歌/);
assert.match(fileReaction.liteFileReaction(['/tmp/movie.mp4']), /电影/);
assert.match(fileReaction.liteFileReaction(['/tmp/mystery.bin']), /工资/);
assert.match(fileReaction.liteFileReaction(['/tmp/a.txt', '/tmp/b.txt']), /2 份工资/);
fileReaction.liteT = makeTranslate(enDict);
assert.match(fileReaction.liteFileReaction(['/tmp/cat.png']), /photo/);
assert.match(fileReaction.liteFileReaction(['/tmp/movie.mp4']), /Movie night/);
assert.match(fileReaction.liteFileReaction(['/tmp/a.txt', '/tmp/b.txt']), /2 paychecks/);

// The affinity model: level thresholds, names and the bar. One shared script so
// the pet that awards points, the settings panel that draws them and the menu
// that prints the level can never disagree about where a level starts.
const affinity = { liteT: makeTranslate(zhDict) };
vm.createContext(affinity);
vm.runInContext(readFileSync(join(renderer, 'lite-affinity.js'), 'utf8'), affinity);
assert.equal(affinity.affinityLevel(0), 0);
assert.equal(affinity.affinityLevel(59), 0, 'the first level runs up to 60');
assert.equal(affinity.affinityLevel(60), 1);
assert.equal(affinity.affinityLevel(199), 1);
assert.equal(affinity.affinityLevel(200), 2);
assert.equal(affinity.affinityLevel(500), 3);
assert.equal(affinity.affinityLevel(1000), 4, '1000 is the last level');
assert.equal(affinity.affinityLevel(99999), 4, 'and there is nothing above it');
assert.equal(affinity.affinityLevelName(0), '陌生');
assert.equal(affinity.affinityLevelName(4), '挚友');
assert.equal(affinity.affinityNextAt(0), 60);
assert.equal(affinity.affinityNextAt(999), 1000);
assert.equal(affinity.affinityNextAt(1000), null, 'a maxed score has no next level');
assert.equal(affinity.affinityProgress(0), 0);
assert.equal(affinity.affinityProgress(30), 0.5, 'halfway to the second level');
assert.equal(affinity.affinityProgress(1000), 1);
// The constants are `const`, so they live in the context's lexical scope rather
// than on the context object — evaluated from inside it, exactly as the pages see
// them (classic scripts share that scope).
const affinityConst = (name) => vm.runInContext(name, affinity);
assert.equal(affinityConst('AFFINITY_MAX'), 1000);
assert.equal(affinityConst('AFFINITY_DAILY_CAP'), 40, 'a day is capped so it cannot be ground out');
assert.equal(affinityConst('AFFINITY_FIRST_HELLO'), 5);
affinity.liteT = makeTranslate(enDict);
assert.equal(affinity.affinityLevelName(4), 'Best Friend');

// Achievements: the catalogue, the thresholds and the one-way unlock edge. The
// pet awards from this shared script and Settings draws the same view, so a
// badge here is the only place its target can live.
const badges = { liteT: makeTranslate(zhDict) };
vm.createContext(badges);
vm.runInContext(readFileSync(join(renderer, 'lite-day.js'), 'utf8'), badges);
vm.runInContext(readFileSync(join(renderer, 'lite-achievements.js'), 'utf8'), badges);
const badgeDefinitions = badges.achievementDefinitions();
assert.equal(badgeDefinitions.length, 22);
assert.equal(new Set(badgeDefinitions.map(definition => definition.id)).size, 22,
  'achievement ids are persisted, so they must be unique');
for (const definition of badgeDefinitions) {
  assert.ok(definition.target > 0, `${definition.id} needs a positive target`);
  for (const key of [definition.nameKey, definition.descKey, definition.categoryKey]) {
    for (const dict of [zhDict, enDict]) assert.equal(typeof dict[key], 'string', `missing ${key}`);
  }
}
const blank = {
  statsClicks: 0,
  affinity: 0,
  statsDays: [],
  dailyStats: {},
  achievements: { unlocked: {}, counters: {} },
};
assert.deepEqual(Array.from(badges.achievementFresh(blank), definition => definition.id), [],
  'a fresh install has nothing to backdate');
const firstPoke = { ...blank, statsClicks: 1 };
assert.deepEqual(Array.from(badges.achievementFresh(firstPoke), definition => definition.id), ['first_click']);
const busy = {
  ...blank,
  statsClicks: 100,
  statsDays: ['2026-10-01'],
  dailyStats: { '2026-10-01': { clicks: 50 } },
  achievements: { unlocked: { first_click: '2026-01-01' }, counters: { feeds: 10 } },
};
const busyFresh = Array.from(badges.achievementFresh(busy), definition => definition.id);
assert.ok(busyFresh.includes('clicks_100'));
assert.ok(busyFresh.includes('busy_day'), 'a 50-click day earns the busy-day badge');
assert.ok(busyFresh.includes('first_feed') && busyFresh.includes('feeder_10'));
assert.ok(!busyFresh.includes('first_click'), 'an earned badge is never awarded twice');
assert.ok(!busyFresh.includes('clicks_1000'), 'the next threshold stays locked');
const sevenDays = [...Array(7)].map((_, index) => `2026-10-0${index + 1}`);
const streakContext = badges.achievementContext({ ...blank, statsDays: sevenDays });
assert.equal(streakContext.days, 7);
assert.equal(streakContext.streak, 7, 'seven consecutive local days are one streak');
assert.ok(Array.from(badges.achievementFresh({ ...blank, statsDays: sevenDays }), definition => definition.id)
  .includes('streak_7'));
const unlocked = badges.achievementStateWithUnlocks(
  { unlocked: { first_click: '2026-10-01' }, counters: {} },
  ['first_click', 'clicks_100'],
  '2026-10-26',
);
assert.equal(unlocked.unlocked.first_click, '2026-10-01', 'the first award date is the honest one');
assert.equal(unlocked.unlocked.clicks_100, '2026-10-26');
const raised = badges.achievementStateWithCounter({ unlocked: {}, counters: { feeds: 2 } }, 'feeds', 3);
assert.equal(raised.counters.feeds, 5);
const playView = badges.achievementView({
  ...blank,
  achievements: { unlocked: {}, counters: { toyCatches: 5 } },
}).find(item => item.definition.id === 'play_10');
assert.equal(playView.value, 5);
assert.equal(playView.target, 10);
assert.equal(playView.progress, 0.5);
assert.equal(playView.unlocked, false);
const badgesHtml = readFileSync(join(renderer, 'settings.html'), 'utf8');
assert.match(badgesHtml, /id="achievement-grid"/);
assert.match(badgesHtml, /lite-achievements\.js/);

// The care model: hunger drift, the three treats, the tray geometry and the
// wand. The pet window, the settings panel and the tests all read this one
// script, so a food cannot have one effect on a button and another in the tray.
const care = {};
vm.createContext(care);
vm.runInContext(readFileSync(join(renderer, 'lite-care.js'), 'utf8'), care);
const careConst = (name) => vm.runInContext(name, care);
const careJson = (expression) => JSON.parse(JSON.stringify(vm.runInContext(expression, care)));
const foods = careJson('CARE_FOODS');
assert.deepEqual(foods.map(food => food.id), ['fish', 'can', 'milk']);
for (const food of foods) {
  assert.ok(food.icon.length > 0, `${food.id} needs an icon`);
  assert.ok(food.hunger > 0, `${food.id} must actually feed the pet`);
  assert.ok(food.affinity > 0, `${food.id} must be worth affection`);
  for (const key of [food.nameKey, food.lineKey]) {
    for (const dict of [zhDict, enDict]) assert.equal(typeof dict[key], 'string', `missing ${key}`);
  }
}
// A point every four minutes, clamped at both ends of the 0…100 scale.
assert.equal(care.careAdvanceHunger(0, 4), 1);
assert.equal(care.careAdvanceHunger(0, 400), 100, 'a long stretch without food fills the meter');
assert.equal(care.careAdvanceHunger(90, 0), 90);
assert.equal(care.careIsHungry(74), false);
assert.equal(care.careIsHungry(75), true, 'the pet mentions hunger from 75 up');
assert.equal(care.careHungerLevel(0), 'full');
assert.equal(care.careHungerLevel(40), 'ok');
assert.equal(care.careHungerLevel(75), 'hungry');
assert.equal(care.careHungerLevel(100), 'starving');
assert.equal(care.careWillEat(12), false, 'a full pet turns a treat down');
assert.equal(care.careWillEat(13), true);
assert.equal(care.careEat(foods[1], 60), 15, 'the can takes 45 points off');
assert.equal(care.careEat(foods[1], 20), 0, 'and never goes below zero');
assert.equal(care.careFoodById('can').id, 'can');
assert.equal(care.careFoodById('pizza'), null);

// The tray sits above the pet's head, inside the 300 px canvas, and only the
// three bubbles are clickable.
const slots = careJson('careTraySlots()');
assert.equal(slots.length, 3);
for (const slot of slots) {
  assert.ok(slot.x - slot.r > 0 && slot.x + slot.r < 300, 'the tray must fit the canvas width');
  assert.ok(slot.y - slot.r > 0 && slot.y + slot.r < 150, 'the tray stays above the pet');
}
assert.equal(careJson('careFoodAt(150, 48).id'), 'can');
assert.equal(careJson('careFoodAt(78, 48).id'), 'fish');
assert.equal(care.careFoodAt(150, 200), null, 'the middle of the pet is not a treat');
// The treat lands in front of the chest, so the pet can reach it without moving.
const spot = careJson("careEatSpot(careFoodById('can'))");
assert.ok(spot.y > 200 && spot.y < 293 && Math.abs(spot.x - 150) < 40);
assert.equal(care.careEatDrop(0), 0);
assert.equal(care.careEatDrop(careConst('CARE_EAT_DROP_MS')), 1);
assert.equal(care.careEatBite(0), 1, 'the treat is whole while it falls');
assert.equal(care.careEatBite(careConst('CARE_EAT_DURATION_MS')), 0, 'and gone when the meal ends');
assert.ok(care.careEatBite(careConst('CARE_EAT_DURATION_MS') / 2) < 1);
assert.equal(care.careChewDip(0), 0, 'the pet does not dip while the treat is still falling');
assert.ok(care.careChewDip(careConst('CARE_EAT_DURATION_MS') / 2) > 0, 'chewing moves the head');

// The wand stays in the upper band, so the pet's lunge always reads as a reach
// and never needs the window to move. The feather is part of the hit test only
// as "not the pet": the window must stay click-through over it.
for (let t = 0; t < 20_000; t += 250) {
  const head = careJson(`careToySwing(${t})`);
  assert.ok(head.x > 60 && head.x < 240, `wand x out of band at ${t}ms`);
  assert.ok(head.y + careConst('CARE_TOY_HEAD_RADIUS') < 160, `wand dipped onto the pet at ${t}ms`);
}
const firstHead = careJson('careToySwing(0)');
assert.equal(care.careToyHits(firstHead.x, firstHead.y, firstHead), true);
assert.equal(care.careToyHits(20, 260, firstHead), false);
const grip = careJson('CARE_TOY_GRIP');
assert.equal(care.careToyHits((grip.x + firstHead.x) / 2, (grip.y + firstHead.y) / 2, firstHead), true,
  'the string counts as the wand so it never traps the cursor');
assert.equal(care.carePounceAmount(0, null), 0);
const window0 = { startedAt: 0, until: careConst('CARE_TOY_POUNCE_MS'), at: { x: 150, y: 76 } };
assert.ok(care.carePounceAmount(0, window0) < 1e-9, 'the lunge starts at rest');
assert.ok(care.carePounceAmount(careConst('CARE_TOY_POUNCE_MS'), window0) < 1e-9,
  'and settles back down at the end');
assert.ok(care.carePounceAmount(careConst('CARE_TOY_POUNCE_MS') / 2, window0) > 0.9,
  'the lunge peaks in the middle of the pounce');

// The wire-up: the caretakers are exactly the two menu entries plus the command
// the settings panel calls, and the window that hosts the menu has to be tall
// enough for them (the generic height check above only sees the total).
const careMarkup = readFileSync(join(renderer, 'menu.html'), 'utf8');
assert.match(careMarkup, /data-action="care:tray"/);
assert.match(careMarkup, /data-action="care:toy"/);
for (const page of ['index.html', 'settings.html']) {
  assert.match(readFileSync(join(renderer, page), 'utf8'), /lite-care\.js/,
    `${page} must load the shared care model`);
}
assert.match(readFileSync(join(process.cwd(), 'src-tauri', 'src', 'tray.rs'), 'utf8'), /pet_care/);
assert.match(readFileSync(join(process.cwd(), 'src-tauri', 'src', 'tray.rs'), 'utf8'), /pet-care/);
assert.match(readFileSync(join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8'), /tray::pet_care/);
assert.match(readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-app.ts'), 'utf8'), /onPetCare/);

// Edge snapping: the rule lives in Rust (it needs the work area and the display
// scale), so what the page owes is the switch that turns it on and the landing move
// that asks for the magnet. Every link is asserted, because the setting spent a
// while on disk — config, i18n label and snap code all present — with nothing in the
// UI to reach it.
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="snap-to-edge"/,
  'settings.html needs the snap-to-edge toggle');
assert.match(readFileSync(join(renderer, 'lite-settings.js'), 'utf8'), /snapToEdge/,
  'the snap-to-edge toggle has to write the config');
const windowRs = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'window.rs'), 'utf8');
assert.match(windowRs, /snap_if_enabled\(&window, anchor\.visual_bounds/,
  'a drag has to apply the magnet while the button is still down');
assert.match(windowRs, /fn snap_position/, 'the snap rule has to stay a shared pure function');
// …and the throw stays out of it. A flick flies on `window_move_to`, which clamps the
// whole window and never asks for the magnet, and the release tells Rust not to dock.
// Both halves matter: snapping the landing would move a pet that was never dragged.
assert.match(windowRs, /pub fn window_move_to\([\s\S]{0,400}?clamp_whole_window/,
  'the flight move must not depend on the snap setting');
assert.doesNotMatch(windowRs, /snapIfEnabled|window_move_and_snap/,
  'the throw path must not acquire a snapping variant later');
const liteApp = readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-app.ts'), 'utf8');
assert.match(liteApp, /dragEnd\(visibleRect, !velocity\)/,
  'a flick has to release without letting the drop dock the pet');
assert.doesNotMatch(liteApp, /moveWindowAndSnap/, 'the landing move must stay a plain move');

for (const page of ['index.html', 'settings.html', 'mask.html']) {
  const html = readFileSync(join(renderer, page), 'utf8');
  assert.match(html, /lite-api\.js/);
  assert.match(html, /lite-i18n\.js/);
  assert.doesNotMatch(html, /chat\.js|wardrobe\.js|pet-library\.js|anim-debug\.js/);
}
assert.match(readFileSync(join(renderer, 'menu.html'), 'utf8'), /lite-menu\.js/);
assert.match(readFileSync(join(renderer, 'menu.html'), 'utf8'), /lite-i18n\.js/);
// The right-click menu prints the affinity level, so it needs both the shared
// model and the line to print it into.
const menuMarkup = readFileSync(join(renderer, 'menu.html'), 'utf8');
assert.match(menuMarkup, /id="menu-affinity"/);
assert.match(menuMarkup, /lite-affinity\.js/);

// The cutout mask editor is a third page: it must ship its own script and the
// controls the brush logic binds to, and the settings panel has to offer a way in.
const maskPage = readFileSync(join(renderer, 'mask.html'), 'utf8');
assert.match(maskPage, /lite-mask\.js/);
assert.match(maskPage, /lite-api\.js/);
for (const id of ['stage', 'mask-view', 'tool-erase', 'tool-restore', 'brush-size', 'brush-hardness',
  'cutout-strength', 'cutout-feather', 'rerun', 'start-over', 'undo', 'redo', 'fit', 'show-original',
  'before-preview', 'after-preview', 'apply']) {
  assert.match(maskPage, new RegExp(`id="${id}"`), `mask.html is missing #${id}`);
}
assert.match(readFileSync(join(renderer, 'lite-mask.js'), 'utf8'), /destination-out/,
  'the erase brush has to cut through the mask alpha');
assert.match(readFileSync(join(renderer, 'lite-mask.css'), 'utf8'), /repeating-conic-gradient/,
  'the stage needs a checkerboard so erased pixels are visible');
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="refine-image"/,
  'Settings needs the "refine the cutout" entry point');

// Software updates: the panel that drives src-tauri/src/updater.rs.
const settingsHtml = readFileSync(join(renderer, 'settings.html'), 'utf8');
for (const id of ['update-panel', 'update-version', 'update-status', 'update-progress-row', 'update-progress-bar',
  'update-progress-text', 'btn-check-update', 'btn-download-update', 'btn-install-update',
  'update-auto-check', 'update-auto-download', 'update-notes-box', 'update-notes', 'update-manual']) {
  assert.match(settingsHtml, new RegExp(`id="${id}"`), `settings.html is missing #${id}`);
}
const liteApi = readFileSync(join(renderer, 'lite-api.js'), 'utf8');
for (const command of ['update_get_state', 'update_check', 'update_download', 'update_install']) {
  assert.match(liteApi, new RegExp(command), `lite-api is missing the ${command} bridge`);
}

// The auto-updater chain was silently dropped once: `updater.rs` stayed on disk
// but was gitignored and no longer compiled, while the workflow kept publishing
// releases. Every link is asserted here so that cannot happen quietly again.
assert.doesNotMatch(readFileSync(join(process.cwd(), '.gitignore'), 'utf8'),
  /^\/src-tauri\/src\/updater\.rs$/m, 'updater.rs must not be gitignored');
for (const [file, pattern] of [
  ['src-tauri/src/lib.rs', /mod updater;/],
  ['src-tauri/src/lib.rs', /tauri_plugin_updater::Builder::new\(\)\.build\(\)/],
  ['src-tauri/src/lib.rs', /updater::update_check/],
  ['src-tauri/Cargo.toml', /tauri-plugin-updater/],
  ['src-tauri/tauri.conf.json', /"createUpdaterArtifacts": true/],
  // The decoded public-key file and original identity are validated above.
  ['src-tauri/tauri.conf.json', /"pubkey": "[A-Za-z0-9+/]+={0,2}"/],
  ['src-tauri/tauri.conf.json', /Aceeee2077\/BoolooPet\/releases\/latest\/download\/latest\.json/],
  ['.github/workflows/release.yml', /tauri-apps\/tauri-action@v1/],
]) {
  assert.match(readFileSync(join(process.cwd(), file), 'utf8'), pattern, `${file} lost its updater wiring`);
}

// macOS support. Every one of these is invisible on Windows: transparency needs
// the private API in two places (config flag + cargo feature), the bundler needs
// a real multi-size .icns, and the menu bar needs its monochrome template icon.
// They would only blow up on a Mac, which is exactly why they are asserted here.
const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
assert.equal(tauriConfig.app.macOSPrivateApi, true, 'macOS transparency needs app.macOSPrivateApi');
assert.match(readFileSync(join(process.cwd(), 'src-tauri', 'Cargo.toml'), 'utf8'), /"macos-private-api"/,
  'the config flag also needs the tauri cargo feature');
assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'), 'the macOS bundler needs icons/icon.icns');
const icns = readFileSync(join(process.cwd(), 'src-tauri', 'icons', 'icon.icns'));
assert.equal(icns.toString('ascii', 0, 4), 'icns', 'icon.icns must be a real icns file');
assert.equal(icns.readUInt32BE(4), icns.length, 'the icns length field must match the file size');
for (const [file, pattern] of [
  ['src-tauri/src/tray.rs', /tray-mac\.png/],
  ['src-tauri/src/tray.rs', /icon_as_template\(true\)/],
  ['src-tauri/src/lib.rs', /ActivationPolicy::Accessory/],
  ['.github/workflows/release.yml', /aarch64-apple-darwin/],
  ['.github/workflows/release.yml', /x86_64-apple-darwin/],
]) {
  assert.match(readFileSync(join(process.cwd(), file), 'utf8'), pattern, `${file} lost its macOS wiring`);
}
assert.ok(existsSync(join(process.cwd(), 'src', 'assets', 'tray-mac.png')), 'the macOS tray template is missing');
assert.ok(existsSync(join(process.cwd(), '.github', 'workflows', 'build.yml')),
  'the release-free build check workflow is missing');

// A typo in a key renders as the key itself, so both sides of the lookup are checked.
for (const page of ['index.html', 'settings.html', 'mask.html', 'menu.html']) {
  const html = readFileSync(join(renderer, page), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-label|-title)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length > 0, `${page} should mark its static text for translation`);
  for (const key of keys) {
    assert.equal(typeof zhDict[key], 'string', `${page}: zh is missing ${key}`);
    assert.equal(typeof enDict[key], 'string', `${page}: en is missing ${key}`);
  }
}
const scriptKeys = new Set();
for (const name of readdirSync(join(process.cwd(), 'src', 'renderer'))) {
  if (!name.startsWith('lite-') || !name.endsWith('.ts')) continue;
  const source = readFileSync(join(process.cwd(), 'src', 'renderer', name), 'utf8');
  for (const match of source.matchAll(/liteT\('([^']+)'/g)) scriptKeys.add(match[1]);
}
assert.ok(scriptKeys.size > 10, `the lite scripts should translate through liteT (found ${scriptKeys.size})`);
for (const key of scriptKeys) {
  assert.equal(typeof zhDict[key], 'string', `zh is missing ${key}`);
  assert.equal(typeof enDict[key], 'string', `en is missing ${key}`);
}

assert.match(readFileSync(join(renderer, 'lite-menu.css'), 'utf8'), /#fff8f2/);
// The settings panel is a floating glass card, so the title bar has to span the
// card's full width and carry its top rounding — inset by the panel's padding it
// reads as a narrower strip glued to the top. The 24 px inset therefore belongs
// to `header` / `section`, and the sticky offset matches the card's margin.
const settingsCss = readFileSync(join(renderer, 'lite-settings.css'), 'utf8');
assert.match(settingsCss, /header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);
assert.match(settingsCss, /header\s*\{[^}]*border-radius:\s*20px\s+20px\s+0\s+0;/);
// ...and the card has to reach the window edges: an outer margin leaves a
// transparent ring that reads as a gap around the panel.
assert.match(settingsCss, /\.panel\s*\{[^}]*padding:\s*0\s+0\s+24px;/);
assert.match(settingsCss, /\.panel\s*\{[^}]*margin:\s*0;/);

// The two READMEs — English at the root, Chinese beside it — share the demo GIF
// and the promo GIF link, but each embeds its own static screenshots: the
// English one pointed at the Chinese panel for a while, which this guards
// against. Both also have to offer a way across to the other language up in the
// header, where a reader actually lands — a footer link alone is easy to miss.
for (const [readme, expected, other] of [
  ['README.md', ['docs/screenshots/lightweight-pet-en.png', 'docs/screenshots/lightweight-settings-en.png'], './README.zh-CN.md'],
  ['README.zh-CN.md', ['docs/screenshots/lightweight-pet.png', 'docs/screenshots/lightweight-settings.png'], './README.md'],
]) {
  const markdown = readFileSync(join(process.cwd(), readme), 'utf8');
  const header = markdown.slice(0, markdown.indexOf('\n## '));
  assert.ok(header.includes(`](${other})`),
    `${readme} should link to ${other} above the first section`);
  assert.ok(markdown.includes('](docs/demo.gif)'),
    `${readme} should embed the shared demo GIF`);
  assert.ok(markdown.includes('](docs/screenshots/booloo-promo.gif)'),
    `${readme} should link the shared promo GIF`);
  const images = [...markdown.matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/g)].map(match => match[1]);
  assert.deepEqual(images, expected,
    `${readme} should embed the ${readme === 'README.md' ? 'English' : 'Chinese'} screenshots`);
  for (const image of images) assert.ok(existsSync(join(process.cwd(), image)), `${image} is missing`);
}

const actionAtlas = join(process.cwd(), 'dist', 'assets', 'animated-pets', 'bulu-actions.webp');
const actionMeta = await sharp(actionAtlas).metadata();
// One 192 px row per action and 16 frames per row: each source sheet is a 4x4 grid
// of animation frames, flattened into the row in reading order.
const actionCell = 192;
const actionFrames = 16;
assert.equal(actionMeta.width, actionCell * actionFrames);
assert.equal(actionMeta.height, actionCell * 5);
assert.equal(actionMeta.hasAlpha, true);
// The atlas and the right-click menu must agree on how many actions exist —
// adding a button without a pose row (or the other way round) fails here.
const menuHtml = readFileSync(join(renderer, 'menu.html'), 'utf8');
const menuActions = [...menuHtml.matchAll(/data-action="action:([a-z]+)"/g)].map(match => match[1]);
assert.equal(actionMeta.height / actionCell, menuActions.length,
  `the atlas has ${actionMeta.height / actionCell} pose rows but the menu offers ${menuActions.length} actions`);
assert.ok(/data-action="reminders"/.test(menuHtml), 'the pet menu should offer the reminder entry');
// The menu is a fixed-size window: the page's box and the size Rust builds it
// with have to agree, or the last entry is clipped off the bottom.
const menuCss = readFileSync(join(renderer, 'lite-menu.css'), 'utf8');
const menuHeight = /html, body \{[^}]*height:\s*(\d+(?:\.\d+)?)px/.exec(menuCss)?.[1];
const traySource = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'tray.rs'), 'utf8');
const windowHeight = /inner_size\(188\.0,\s*(\d+(?:\.\d+)?)\)/.exec(traySource)?.[1];
assert.ok(menuHeight && windowHeight, 'the pet menu height should be declared in both places');
assert.equal(Number(menuHeight), Number(windowHeight),
  `lite-menu.css is ${menuHeight}px tall but the window is built ${windowHeight}px tall`);
for (let row = 0; row < actionMeta.height / actionCell; row++) {
  const frames = [];
  for (let col = 0; col < actionFrames; col++) {
    const frame = await sharp(actionAtlas)
      .extract({ left: col * actionCell, top: row * actionCell, width: actionCell, height: actionCell })
      .ensureAlpha().raw().toBuffer();
    let opaque = 0;
    for (let pixel = 3; pixel < frame.length; pixel += 4) if (frame[pixel] > 16) opaque++;
    assert.ok(opaque > 1000, `Bulu action row ${row}, frame ${col} is empty`);
    frames.push(frame);
  }
  assert.notDeepEqual(frames[0], frames[8], `Bulu action row ${row} does not move`);
}

// The base sheet: idle / walk / sleep / click, now at the atlas' 192 px cells so
// the resting state is as crisp as an action. Idle is a *still* pose — the pet must
// not move on its own, only walking (auto-walk or dragging) animates.
const sheetPath = join(process.cwd(), 'dist', 'assets', 'animated-pets', 'bulu.png');
const sheetMeta = await sharp(sheetPath).metadata();
assert.equal(sheetMeta.width, actionCell * 4);
assert.equal(sheetMeta.height, actionCell * 4);
const sheetFrame = (row, col) => sharp(sheetPath)
  .extract({ left: col * actionCell, top: row * actionCell, width: actionCell, height: actionCell })
  .ensureAlpha().raw().toBuffer();
const idleFrames = [await sheetFrame(0, 0), await sheetFrame(0, 1), await sheetFrame(0, 2)];
assert.deepEqual(idleFrames[1], idleFrames[0], 'the idle state must not animate');
assert.deepEqual(idleFrames[2], idleFrames[0], 'the idle state must not animate');
// The fourth idle cell is the blink pose baked by scripts/build-bulu-blink.mjs:
// the same picture with both eyes closed, so the silhouette may not change and
// nothing outside the band across the eyes may move.
const blinkFrame = await sheetFrame(0, 3);
let blinkPixels = 0;
let blinkOutsideEyes = 0;
for (let pixel = 0; pixel < blinkFrame.length; pixel += 4) {
  const index = pixel / 4;
  const x = index % actionCell;
  const y = Math.floor(index / actionCell);
  assert.equal(blinkFrame[pixel + 3], idleFrames[0][pixel + 3],
    `the blink frame must keep the silhouette at ${x},${y}`);
  if (blinkFrame[pixel] === idleFrames[0][pixel] &&
      blinkFrame[pixel + 1] === idleFrames[0][pixel + 1] &&
      blinkFrame[pixel + 2] === idleFrames[0][pixel + 2]) continue;
  blinkPixels++;
  if (y < 50 || y > 70 || x < 60 || x > 150) blinkOutsideEyes++;
}
assert.ok(blinkPixels > 200, `both eyes have to close, only ${blinkPixels} pixels differ`);
assert.equal(blinkOutsideEyes, 0, 'the blink may only repaint the band across the eyes');
const walkFrames = [await sheetFrame(1, 0), await sheetFrame(1, 1)];
assert.notDeepEqual(walkFrames[1], walkFrames[0], 'the walk cycle still animates');
// And no frame may carry a piece of its neighbour: every cell has to be one blob.
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const frame = await sheetFrame(row, col);
    let opaque = 0;
    for (let pixel = 3; pixel < frame.length; pixel += 4) if (frame[pixel] > 16) opaque++;
    assert.ok(opaque > 1000, `base sheet row ${row} frame ${col} is empty`);
  }
}

// Both dictionaries are handed to the renderer as one JSON payload, so a key
// that only exists in one of them would silently render as its own name.
assert.deepEqual(Object.keys(enDict).sort(), Object.keys(zhDict).sort(), 'zh/en dictionaries must stay in sync');
const liteKeys = Object.keys(zhDict).filter(key => key.startsWith('lite.'));
assert.ok(liteKeys.length > 40, `the lightweight pages need their own keys (found ${liteKeys.length})`);

// The renderer runtime: translate, fill {params}, and rewrite the marked-up DOM.
const textNode = { dataset: { i18n: 'lite.pet.petting' }, textContent: '' };
const labelNode = { dataset: { i18nLabel: 'lite.pet.canvas' }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
const dom = {
  documentElement: {},
  querySelectorAll: (selector) => selector === '[data-i18n]' ? [textNode]
    : selector === '[data-i18n-label]' ? [labelNode] : [],
};
const i18n = { window: { api: { getI18n: async () => ({ locale: 'en', dict: enDict }) } }, document: dom, console };
vm.createContext(i18n);
vm.runInContext(readFileSync(join(renderer, 'lite-i18n.js'), 'utf8'), i18n);
assert.equal(i18n.liteT('lite.drop.other'), 'lite.drop.other', 'before the dictionary arrives, keys fall back to themselves');
assert.equal(i18n.liteT('lite.drop.multiple', { n: 3 }), 'lite.drop.multiple');
await i18n.liteLoadDictionary();
assert.equal(i18n.liteCurrentLocale(), 'en');
assert.equal(dom.documentElement.lang, 'en');
assert.equal(textNode.textContent, enDict['lite.pet.petting']);
assert.equal(labelNode.attributes['aria-label'], enDict['lite.pet.canvas']);
assert.equal(i18n.liteT('lite.drop.multiple', { n: 3 }), 'Whoa, 3 paychecks? I am rich!');

// ---- the walking gait ------------------------------------------------------
// One clock for the legs, the body and the ground covered. This module is what
// stopped the body bob drifting through the walk cycle, and the pet window cannot
// be driven from a test, so its numbers are pinned here instead.
const gait = {};
vm.createContext(gait);
vm.runInContext(readFileSync(join(renderer, 'lite-gait.js'), 'utf8'), gait);
const gaitConst = (name) => vm.runInContext(name, gait);
assert.equal(gaitConst('GAIT_FRAME_MS'), 125);
assert.equal(gaitConst('GAIT_FRAMES'), 4);
assert.equal(gait.gaitFrameMs(1), 125);
assert.equal(gait.gaitStrideMs(1), 500, 'four frames make one stride');
assert.equal(gait.gaitFps(1), 8);
assert.equal(gait.gaitStridePx(1), 24);
// The speed the pet window used to hard-code is now derived from the stride, so
// the legs and the window cannot disagree when either one is retuned.
assert.equal(gait.gaitSpeed(1, 1), 48);
assert.equal(gait.gaitSpeed(1, 1.5), 72, 'a bigger pet takes longer steps');
assert.equal(gait.gaitSpeed(2, 1), 96, 'a faster gait covers more ground');
assert.equal(gait.gaitSize(0.1), 0.65);
assert.equal(gait.gaitSize(9), 1.6);
assert.equal(gait.gaitSize(undefined), 1);
assert.equal(gait.gaitRate(0.1), 0.5);
assert.equal(gait.gaitRate(9), 2);
// The phase starts at the walk, not at the wall clock: every walk begins on frame
// 0 (a contact pose) instead of wherever the clock happened to be.
assert.equal(gait.gaitPhase(0, 1), 0);
assert.equal(gait.gaitFrame(0, 1), 0);
assert.equal(gait.gaitFrame(124, 1), 0);
assert.equal(gait.gaitFrame(125, 1), 1);
assert.equal(gait.gaitFrame(499, 1), 3);
assert.equal(gait.gaitFrame(500, 1), 0, 'the fifth frame of walking is the first again');
assert.equal(gait.gaitFrame(1000, 2), 0);
// The bob is the curve that was tuned against the art by eye, only re-expressed
// in the walk's own phase — so the shipped look has to come out bit for bit.
const legacyBob = (t) => (0.5 - Math.abs(Math.sin((Math.PI * (t / 125)) / 2))) * 5;
for (const t of [0, 41, 125, 250, 373, 500, 1201]) {
  assert.ok(Math.abs(gait.gaitBob(t, 1) - legacyBob(t)) < 1e-12, `the bob changed at ${t}ms`);
}
assert.equal(gait.gaitBob(125, 1), -2.5, 'the body dips on the step');
assert.ok(Math.abs(gait.gaitBob(1000, 2) - legacyBob(2000)) < 1e-12, 'twice the rate is twice the cycle');
assert.ok(gait.gaitBob(100, 1) < gait.gaitBob(0, 1), 'and it is in step with the legs');
assert.ok(gait.gaitBob(200, 1) > gait.gaitBob(125, 1));
const appSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-app.ts'), 'utf8');
assert.match(appSource, /gaitBob\(walkElapsed/);
assert.match(appSource, /gaitFrame\(walkElapsed/);
assert.match(appSource, /gaitSpeed\(gaitRate\(config\.animSpeed\)/, 'the glide speed comes from the gait');
assert.match(readFileSync(join(renderer, 'index.html'), 'utf8'), /lite-gait\.js/);

// ---- the weekly summary ----------------------------------------------------
// Read straight out of the per-day counters the pet already keeps, so it can never
// disagree with the heatmap sitting next to it. The week starts on Monday because
// that is the heatmap's row order.
const summary = {};
vm.createContext(summary);
vm.runInContext(readFileSync(join(renderer, 'lite-day.js'), 'utf8'), summary);
vm.runInContext(readFileSync(join(renderer, 'lite-summary.js'), 'utf8'), summary);
const summaryJson = (value) => JSON.parse(JSON.stringify(value));
const week = summary.summaryWeekKeys('2026-01-15');
assert.equal(week.length, 7);
assert.equal(summary.liteDayWeekday(week[0]), 0, 'the week starts on Monday');
for (const day of week) {
  assert.equal(summary.summaryWeekStart(day), week[0], `${day} fell into another week`);
  assert.deepEqual(summary.summaryWeekKeys(day), week, 'and every day agrees on it');
}
const weekStats = {
  [week[0]]: { clicks: 5, stand: 1 },
  [week[3]]: { clicks: 30, stand: 2, eye: 1, water: 1, affinity: 20 },
};
const totals = summaryJson(summary.summaryTotals(weekStats, week[0], week[6]));
assert.equal(totals.from, week[0]);
assert.equal(totals.to, week[6]);
assert.equal(totals.days, 2, 'a day the app was not running is absent, not a zero');
assert.equal(totals.clicks, 35);
assert.equal(totals.stand, 3);
assert.equal(totals.eye, 1);
assert.equal(totals.water, 1);
assert.equal(totals.affinity, 20);
assert.equal(totals.best.date, week[3]);
assert.equal(totals.best.clicks, 30);
// A reversed or empty window reports nothing rather than a negative week.
assert.equal(summary.summaryTotals(weekStats, week[6], week[0]).clicks, 0);
assert.equal(summary.summaryTotals(undefined, week[0], week[6]).days, 0);
assert.equal(summary.summaryTotals({}, week[0], week[6]).best, null);
// The streak counts back from today, and a quiet today does not break it: nothing
// has been recorded yet before the first touch of the day.
assert.equal(summary.summaryStreak({}, week[0]), 0);
assert.equal(summary.summaryStreak(weekStats, week[0]), 1);
assert.equal(summary.summaryStreak({ [week[4]]: { clicks: 1 }, [week[5]]: { clicks: 1 } }, week[5]), 2);
assert.equal(summary.summaryStreak({ [week[4]]: { clicks: 1 } }, week[5]), 1);
assert.equal(summary.summaryStreak({ [week[4]]: { clicks: 1 } }, week[6]), 0, 'a missed day does end it');
// The verdict is a dictionary key, never a sentence baked into the model.
assert.equal(summary.summaryHeadlineKey({ days: 0 }), 'lite.summary.quiet');
assert.equal(summary.summaryHeadlineKey({ days: 4 }), 'lite.summary.steady');
assert.equal(summary.summaryHeadlineKey({ days: 5 }), 'lite.summary.warm');
for (const key of Object.values(vm.runInContext('SUMMARY_HEADLINES', summary))) {
  assert.equal(typeof zhDict[key], 'string', `zh is missing ${key}`);
  assert.equal(typeof enDict[key], 'string', `en is missing ${key}`);
}
const settingsSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-settings.ts'), 'utf8');
assert.match(settingsSource, /paintSummary\(cfg\)/, 'the panel has to paint the week');
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="summary-days"/);

// ---- the year report -------------------------------------------------------
// The weekly counters read a whole year at a time. Only the current year is ever
// shown — the buckets are pruned to about a year — and the window has to end
// today rather than December, or every figure would understate the year.
const report = {};
vm.createContext(report);
vm.runInContext(readFileSync(join(renderer, 'lite-day.js'), 'utf8'), report);
vm.runInContext(readFileSync(join(renderer, 'lite-summary.js'), 'utf8'), report);
vm.runInContext(readFileSync(join(renderer, 'lite-report.js'), 'utf8'), report);
const reportJson = (value) => JSON.parse(JSON.stringify(value));
const today = report.liteDayKey();
const thisYear = Number(today.slice(0, 4));
const thisWindow = report.reportYearWindow(thisYear);
assert.equal(thisWindow.from, `${thisYear}-01-01`);
assert.equal(thisWindow.to, today, 'the year so far ends today, not in December');
const pastWindow = report.reportYearWindow(thisYear - 1);
assert.equal(pastWindow.from, `${thisYear - 1}-01-01`);
assert.equal(pastWindow.to, `${thisYear - 1}-12-31`, 'a finished year ends in December');
// A whole year's arithmetic on the finished year, so nothing shifts with the
// clock: three days in a row, a quiet gap, then one more.
const lastYear = thisYear - 1;
const yearStats = {
  [`${lastYear}-03-01`]: { clicks: 2, stand: 1 },
  [`${lastYear}-03-02`]: { clicks: 3, eye: 1 },
  [`${lastYear}-03-03`]: { clicks: 40, water: 1, affinity: 15 },
  [`${lastYear}-03-05`]: { clicks: 1 },
  [`${thisYear}-01-01`]: { clicks: 99 },
};
const year = reportJson(report.yearReport(yearStats, lastYear));
assert.equal(year.year, lastYear);
assert.equal(year.from, `${lastYear}-01-01`);
assert.equal(year.to, `${lastYear}-12-31`);
assert.equal(year.days, 4);
assert.equal(year.clicks, 46);
assert.equal(year.stand, 1);
assert.equal(year.eye, 1);
assert.equal(year.water, 1);
assert.equal(year.affinity, 15);
assert.equal(year.streak, 3, 'the gap on the 4th breaks the run');
assert.equal(year.busiest.date, `${lastYear}-03-03`);
assert.equal(year.busiest.clicks, 40);
assert.equal(year.first, `${lastYear}-03-01`);
// The other year's bucket stays out of the window it does not belong to.
assert.equal(reportJson(report.yearReport(yearStats, thisYear)).clicks, 99);
// A silent year reports a floor, not a negative or a crash.
const quietYear = reportJson(report.yearReport(undefined, thisYear));
assert.equal(quietYear.days, 0);
assert.equal(quietYear.streak, 0);
assert.equal(quietYear.busiest, null);
assert.equal(quietYear.first, null);
assert.match(settingsSource, /paintReport\(cfg\)/, 'the panel has to paint the year');
assert.match(settingsHtml, /id="report-days"/);
assert.match(settingsHtml, /lite-report\.js/, 'the page has to load the year report');
for (const key of ['lite.report.title', 'lite.report.range', 'lite.report.quiet',
  'lite.report.streakLine', 'lite.report.busiest', 'lite.report.firstLine', 'lite.report.hint']) {
  assert.equal(typeof zhDict[key], 'string', `zh is missing ${key}`);
  assert.equal(typeof enDict[key], 'string', `en is missing ${key}`);
}

// ---- pet packs -------------------------------------------------------------
// An imported character is drawn out of its own sheet: the frames, the grid and
// the walking pace all come from the pack. This is what makes "import a pet" mean
// a pet that walks, rather than one still photograph.
const packs = {};
vm.createContext(packs);
vm.runInContext(readFileSync(join(renderer, 'lite-pack.js'), 'utf8'), packs);
const packJson = (value) => JSON.parse(JSON.stringify(value));
const pack = {
  sprite: { frameWidth: 32, frameHeight: 32, columns: 4, rows: 2, scale: 1 },
  animations: {
    idle: { frames: [0, 1], fps: 8, loop: true },
    walk: { frames: [4, 5, 6, 7], fps: 12, loop: true },
    wave: { frames: [0, 1, 2], fps: 6, loop: false },
  },
};
assert.equal(packs.litePackStateName('walk'), 'walk');
assert.equal(packs.litePackStateName('sleep'), 'sleep');
assert.equal(packs.litePackStateName('click'), 'click');
assert.equal(packs.litePackStateName('idle'), 'idle');
assert.equal(packs.litePackStateName('anything'), 'idle');
assert.equal(packs.litePackAnimationName(pack, 'wave'), 'wave');
assert.equal(packs.litePackAnimationName(pack, 'groom'), 'idle', 'a missing action falls back to idling');
assert.equal(
  packs.litePackAnimationName({ sprite: pack.sprite, animations: { walk: pack.animations.walk } }, 'sleep'),
  'walk',
  'a pack that only walks still shows something',
);
assert.equal(packs.litePackAnimationName({ sprite: pack.sprite, animations: {} }, 'idle'), null);
// Frames advance on the pack's own fps, from the moment the animation started.
assert.equal(packs.litePackFrameIndex(pack.animations.idle, 0), 0);
assert.equal(packs.litePackFrameIndex(pack.animations.idle, 200), 1);
assert.equal(packs.litePackFrameIndex(pack.animations.idle, 250), 0, 'and loop back');
assert.equal(packs.litePackFrameIndex(pack.animations.walk, 84), 1);
assert.equal(packs.litePackFrameIndex(pack.animations.walk, 1000), 0, '12 fps for a second, wrapped');
assert.equal(packs.litePackFrameIndex(pack.animations.wave, 10_000), 2, 'a one-shot holds its last frame');
assert.equal(packs.litePackFrameIndex(pack.animations.idle, -50), 0, 'a clock that has not started cannot skip ahead');
// Frame numbers run left to right and then down, exactly like the built-in sheets.
assert.deepEqual(packJson(packs.litePackFrameRect(pack, 0)), { x: 0, y: 0, w: 32, h: 32 });
assert.deepEqual(packJson(packs.litePackFrameRect(pack, 3)), { x: 96, y: 0, w: 32, h: 32 });
assert.deepEqual(packJson(packs.litePackFrameRect(pack, 4)), { x: 0, y: 32, w: 32, h: 32 });
assert.deepEqual(packJson(packs.litePackFrameRect(pack, 7)), { x: 96, y: 32, w: 32, h: 32 });
// The glide speed follows the pack's legs rather than Bulu's 8 fps.
assert.equal(packs.litePackWalkFps(pack), 12);
assert.equal(packs.litePackWalkFps({ sprite: pack.sprite, animations: { idle: pack.animations.idle } }), 0);
assert.equal(packs.litePackWalkFps({ sprite: pack.sprite, animations: { walk: { frames: [0], fps: 0, loop: true } } }), 8);
assert.match(appSource, /loadPack/, 'the pet window has to load the active pack');
assert.match(appSource, /litePackAnimationName\(definition/);
assert.match(appSource, /litePackFrameRect\(definition/);
assert.match(appSource, /pack\.sheet, frame\.x, frame\.y/);
const apiSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-api.ts'), 'utf8');
for (const command of ['pet_list', 'pet_import', 'pet_export', 'pet_remove']) {
  assert.match(apiSource, new RegExp(command), `lite-api is missing the ${command} bridge`);
}
const libSource = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8');
assert.match(libSource, /mod petpack;/);
for (const command of ['petpack::pet_list', 'petpack::pet_import', 'petpack::pet_export', 'petpack::pet_remove']) {
  assert.match(libSource, new RegExp(command), `${command} is not registered`);
}
const tauriConfigFile = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));
assert.ok(tauriConfigFile.app.security.assetProtocol.scope.includes('$APPCONFIG/pets/**'),
  'a pack sheet has to be readable through the asset protocol');
// A module nothing compiles is a feature that quietly disappears: this is exactly
// how updater.rs was dropped once, so the ignore file is checked for both halves.
const ignoreFile = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
assert.doesNotMatch(ignoreFile, /^\/src-tauri\/src\/petpack\.rs$/m, 'petpack.rs must not be gitignored');
assert.doesNotMatch(ignoreFile, /^\/src\/renderer\/lite-pack\.ts$/m, 'lite-pack.ts must not be gitignored');
assert.match(settingsSource, /petImport\(\)/);
assert.match(settingsSource, /petExport\(id\)/);
assert.match(settingsSource, /petRemove\(id\)/);
assert.match(readFileSync(join(renderer, 'index.html'), 'utf8'), /lite-pack\.js/);
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="packs"/);
assert.match(readFileSync(join(renderer, 'settings.html'), 'utf8'), /id="import-pack"/);
// The Rust side translates its refusals out of the dictionary it embeds, so the
// *built* resource is what has to carry the keys — not just the TypeScript source.
const packKeys = ['lite.pack.imported', 'lite.pack.exported', 'lite.pack.removed', 'lite.pack.importFailed',
  'lite.pack.exportFailed', 'lite.pack.removeFailed', 'lite.pack.noManifest', 'lite.pack.notFound',
  'lite.pack.badSchema', 'lite.pack.badSprite', 'lite.pack.badAnimation', 'lite.pack.badSheet',
  'lite.pack.missingSheet', 'lite.pack.tooLarge', 'lite.pack.badId'];
const packResource = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri', 'resources', 'i18n.json'), 'utf8'));
for (const key of packKeys) {
  for (const locale of ['zh', 'en']) {
    assert.equal(typeof zhDict[key], 'string', `${locale}Dictionary in src/shared/i18n.ts is missing ${key}`);
    assert.equal(typeof packResource[locale][key], 'string', `src-tauri/resources/i18n.json is missing ${locale} ${key}`);
  }
}
// The visual editor is the same pack surface seen from the other side: the three
// Rust commands, the two renderer entry points, and the section that hosts them.
assert.ok(tauriConfigFile.app.security.assetProtocol.scope.includes('$APPCONFIG/pack-draft/**'),
  'a draft sheet has to be readable through the asset protocol');
for (const command of ['pet_editor_open', 'pet_editor_pick', 'pet_save']) {
  assert.match(apiSource, new RegExp(command), `lite-api is missing the ${command} bridge`);
  assert.match(libSource, new RegExp(`petpack::${command}`), `${command} is not registered`);
}
assert.doesNotMatch(ignoreFile, /^\/src\/renderer\/lite-pack-editor\.ts$/m,
  'lite-pack-editor.ts must not be gitignored');
assert.match(settingsHtml, /id="pack-editor"/);
assert.match(settingsHtml, /id="new-pack"/);
assert.match(settingsHtml, /lite-pack-editor\.js/);
assert.match(settingsSource, /litePackEditor\?\.open/);
assert.match(settingsSource, /'edit'/);
console.log('Walking gait (one clock for legs, body and ground): passed');

// ---- data backup -----------------------------------------------------------
// A backup is a folder of the three data parts, and a restore replaces the live
// data rather than merging into it. The Rust half cannot be driven through a
// dialog here, so it is checked by name; the renderer half by its bridge and the
// two buttons it hangs on.
for (const command of ['backup_export', 'backup_import']) {
  assert.match(apiSource, new RegExp(command), `lite-api is missing the ${command} bridge`);
}
assert.match(libSource, /mod backup;/);
assert.match(libSource, /backup::backup_export/);
assert.match(libSource, /backup::backup_import/);
assert.doesNotMatch(ignoreFile, /^\/src-tauri\/src\/backup\.rs$/m, 'backup.rs must not be gitignored');
assert.doesNotMatch(ignoreFile, /^\/src\/renderer\/lite-report\.ts$/m, 'lite-report.ts must not be gitignored');
assert.match(settingsHtml, /id="backup-export"/);
assert.match(settingsHtml, /id="backup-import"/);
assert.match(settingsSource, /backupExport\(\)/);
assert.match(settingsSource, /backupImport\(\)/);
const backupKeys = ['lite.backup.title', 'lite.backup.hint', 'lite.backup.export', 'lite.backup.import',
  'lite.backup.exported', 'lite.backup.restored', 'lite.backup.failed', 'lite.backup.notBackup'];
for (const key of backupKeys) {
  assert.equal(typeof zhDict[key], 'string', `zhDictionary in src/shared/i18n.ts is missing ${key}`);
  assert.equal(typeof enDict[key], 'string', `enDictionary in src/shared/i18n.ts is missing ${key}`);
  for (const locale of ['zh', 'en']) {
    assert.equal(typeof packResource[locale][key], 'string', `src-tauri/resources/i18n.json is missing ${locale} ${key}`);
  }
}
console.log('Data backup (export a folder, replace on restore): passed');
// ---- the throw --------------------------------------------------------------
// Dragging is native (window.rs); everything that happens after the button comes
// up is this model: the release velocity, the friction, and the four walls.
const thrown = {};
vm.createContext(thrown);
vm.runInContext(readFileSync(join(renderer, 'lite-throw.js'), 'utf8'), thrown);
const throwConst = (name) => vm.runInContext(name, thrown);
const throwJson = (value) => JSON.parse(JSON.stringify(value));
const box = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
assert.equal(throwConst('THROW_MAX_SPEED'), 2600);
assert.equal(throwConst('THROW_LAUNCH_SPEED'), 420);
assert.equal(throwConst('THROW_PEAK_SPAN_MS'), 30, 'the launch is judged on the fastest 30 ms of the gesture');
assert.equal(throwConst('THROW_TAIL_SPAN_MS'), 12, 'the release is judged over a span, never between two events');
assert.equal(throwConst('THROW_MIN_TAIL_PX'), 1);
assert.equal(throwConst('THROW_TAIL_MIN_SPEED'), 90);
assert.equal(throwConst('THROW_BOUNCE'), 0.62);
assert.equal(throwConst('THROW_STOP_SPEED'), 40);
assert.equal(throwConst('THROW_GRAVITY'), 0, 'the throw asks for friction and walls, not an arc');
assert.ok(throwConst('THROW_TAIL_SPAN_MS') < throwConst('THROW_TAIL_MS'),
  'the tail is a span of movement, and it still has to be recent');
assert.ok(throwConst('THROW_TAIL_MS') <= throwConst('THROW_SAMPLE_MS'));
assert.ok(throwConst('THROW_PEAK_SPAN_MS') <= throwConst('THROW_SAMPLE_MS'),
  'the fastest stretch has to fit inside the window it is looked for in');
assert.ok(throwConst('THROW_BUFFER_MS') > throwConst('THROW_SAMPLE_MS'),
  'the gesture buffer has to hold more than the window the judgement reads');
const toStep = throwConst('THROW_STEP_MS');
assert.equal(Math.round(toStep), 17, 'the friction numbers are tuned per 60 fps frame');

// The release velocity is read from the tail of the gesture.
assert.deepEqual(throwJson(thrown.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 100 }])), { vx: 1000, vy: 0 });
assert.deepEqual(throwJson(thrown.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 0, y: 50, t: 50 }])), { vx: 0, vy: 1000 });
// A pointer held still before letting go is a placement, not a throw: only the last
// 120 ms count, so the pause cannot be averaged into speed.
const held = [{ x: 0, y: 0, t: 0 }, { x: 300, y: 0, t: 100 }, { x: 300, y: 0, t: 300 }, { x: 300, y: 0, t: 420 }];
assert.deepEqual(throwJson(thrown.throwVelocity(held)), { vx: 0, vy: 0 });
assert.equal(thrown.throwVelocity([{ x: 0, y: 0, t: 0 }]), null, 'one sample is a tap, not a throw');
assert.equal(thrown.throwVelocity([{ x: 0, y: 0, t: 5 }, { x: 9, y: 0, t: 5 }]), null, 'and no time passed');
assert.equal(thrown.throwVelocity([]), null);
// One fast flick cannot teleport the pet across the screen.
const capped = thrown.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 10_000, y: 0, t: 100 }]);
assert.ok(Math.abs(capped.vx - 2600) < 1e-6, `the launch speed is capped, got ${capped.vx}`);
assert.equal(thrown.throwCanLaunch(419), false);
assert.equal(thrown.throwCanLaunch(420), true);
assert.equal(thrown.throwCanLaunch(Number.NaN), false, 'no gesture is not a throw');

// The gate that decides whether the gesture was a throw at all. It reads the fastest
// stretch of the gesture, not its average: a flick is quick in the middle and already
// slowing when the button comes up, and asking the whole window to average 420 px/s
// made a normal flick do nothing.
const steadyDrag = (speed, ms, rateHz) => {
  const samples = [];
  const dt = 1000 / rateHz;
  for (let t = 0; t <= ms + 1e-9; t += dt) samples.push({ x: Math.round((speed * t) / 1000), y: 0, t });
  return samples;
};
/** A stroke that accelerates to `peak` and falls back, released at a fraction of it. */
const stroked = (peak, ms, rateHz, fraction) => {
  const samples = [];
  const dt = 1000 / rateHz;
  for (let t = 0; t <= ms * fraction + 1e-9; t += dt) {
    const u = Math.min(t, ms) / ms;
    samples.push({ x: Math.round(((peak * ms) / Math.PI / 1000) * (1 - Math.cos(Math.PI * u))), y: 0, t });
  }
  return samples;
};
// A careful drag tops out at the speed the hand is moving, and that is never a throw.
assert.ok(thrown.throwPeak(steadyDrag(300, 400, 125)) < throwConst('THROW_LAUNCH_SPEED'),
  'a steady 300 px/s drag is not fast enough to be a throw');
assert.equal(thrown.throwRelease(steadyDrag(300, 400, 125)), null);
// A flick reaches 700 px/s in the middle and is down to ~350 px/s at the release: too
// slow for the old window average (520 px/s measured over the window it used to read),
// fast enough now.
const decelerating = stroked(700, 200, 125, 0.9);
assert.ok(thrown.throwPeak(decelerating) > throwConst('THROW_LAUNCH_SPEED'));
assert.ok(thrown.throwRelease(decelerating), 'a flick that is slowing at release still flies');
// Same gesture, same verdict, whatever the mouse reports at: the launch gate reads a
// span of movement, not the gap between two events.
for (const rate of [1000, 500, 250, 125, 60]) {
  const samples = stroked(700, 200, rate, 0.9);
  assert.ok(thrown.throwPeak(samples) >= throwConst('THROW_LAUNCH_SPEED'), `${rate} Hz flick is fast enough`);
  assert.ok(thrown.throwRelease(samples), `a flick thrown with a ${rate} Hz mouse has to fly`);
}
// A soft flick — 500 px/s at its fastest — used to read 384 px/s as a window average
// and do nothing at all.
assert.ok(thrown.throwRelease(stroked(500, 250, 125, 0.9)), 'a soft flick flies too');
// The peak is a *sustained* speed: one sample pair a millisecond apart cannot supply it.
assert.ok(thrown.throwPeak([
  { x: 0, y: 0, t: 0 }, { x: 2, y: 0, t: 50 }, { x: 4, y: 0, t: 90 }, { x: 34, y: 0, t: 95 },
]) < throwConst('THROW_LAUNCH_SPEED'), 'a 5 ms spike is not a sustained 420 px/s');

// The gate that stopped a placement from becoming a throw: the pointer has to have
// been moving at the *release*, not just somewhere earlier in the drag. Without it a
// quick drag that ended in a stop still averaged over the threshold and the pet
// hopped off on its own every time.
const dragThenStop = [
  { x: 0, y: 0, t: 0 }, { x: 12, y: 0, t: 10 }, { x: 24, y: 0, t: 20 }, { x: 36, y: 0, t: 30 },
  { x: 36, y: 0, t: 110 },
];
assert.equal(thrown.throwStillMoving(dragThenStop), false, 'a stop before letting go is not a throw');
assert.equal(thrown.throwRelease(dragThenStop), null, 'and the pet must stay where it was dropped');
const stillFlick = [
  { x: 0, y: 0, t: 0 }, { x: 12, y: 0, t: 10 }, { x: 24, y: 0, t: 20 }, { x: 36, y: 0, t: 30 },
];
assert.equal(thrown.throwStillMoving(stillFlick), true);
assert.deepEqual(throwJson(thrown.throwRelease(stillFlick)), { vx: 1200, vy: 0 });
// Jitter on a hand that is not moving is not movement.
assert.equal(thrown.throwStillMoving([{ x: 10, y: 10, t: 0 }, { x: 10.4, y: 10, t: 60 }]), false);
assert.equal(thrown.throwStillMoving([{ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 20 }]), false);
// The tail only has to be *moving*: a flick's hand is already slowing when the button
// comes up, and asking for the full launch speed there made the pet unthrowable.
assert.equal(thrown.throwStillMoving([{ x: 0, y: 0, t: 0 }, { x: 24, y: 0, t: 10 }, { x: 26, y: 0, t: 26 }]), true,
  'a hand that is slowing down is still moving');
assert.equal(thrown.throwStillMoving([{ x: 0, y: 0, t: 0 }, { x: 24, y: 0, t: 10 }, { x: 24.5, y: 0, t: 26 }]), false,
  'a hand that has stopped is not');
assert.ok(throwConst('THROW_TAIL_MIN_SPEED') < throwConst('THROW_LAUNCH_SPEED'),
  'the release is judged more gently than the gesture as a whole');
// The same hand movement has to read the same at every report rate. Asking the last
// two events for 2 px of movement was a hidden speed floor of (2 px ÷ report interval):
// 2000 px/s on a 1000 Hz gaming mouse, where a 700 px/s flick therefore did nothing at
// all — the pet was easy to throw below 125 Hz and impossible above it.
for (const rate of [1000, 500, 250, 125, 60]) {
  const dt = 1000 / rate;
  const samples = [];
  for (let t = 0; t <= 40 + 1e-9; t += dt) samples.push({ x: Math.round((700 * t) / 1000), y: 0, t });
  assert.equal(thrown.throwStillMoving(samples), true, `a hand moving at 700 px/s is moving at ${rate} Hz`);
  assert.ok(thrown.throwRelease(samples), `and it throws the pet at ${rate} Hz`);
}
// A hand that has stopped is a stop at every report rate too.
for (const rate of [1000, 500, 250, 125]) {
  const dt = 1000 / rate;
  const samples = [];
  for (let t = 0; t <= 40 + 1e-9; t += dt) samples.push({ x: Math.round((700 * t) / 1000), y: 0, t });
  const last = samples[samples.length - 1];
  samples.push({ x: last.x, y: 0, t: last.t + 60 });
  assert.equal(thrown.throwStillMoving(samples), false, `a hand that stopped 60 ms ago has stopped at ${rate} Hz`);
}
// Two events can share a millisecond (a fast mouse, a coarsened clock). The tail has
// to look back past them instead of concluding "no movement".
assert.equal(thrown.throwStillMoving([
  { x: 0, y: 0, t: 0 }, { x: 20, y: 0, t: 10 }, { x: 46, y: 0, t: 20 }, { x: 72, y: 0, t: 20 },
]), true, 'same-millisecond events must not hide a flick');
const sameMsThrow = thrown.throwRelease([
  { x: 0, y: 0, t: 0 }, { x: 20, y: 0, t: 10 }, { x: 46, y: 0, t: 20 }, { x: 72, y: 0, t: 20 },
]);
assert.ok(sameMsThrow && Math.hypot(sameMsThrow.vx, sameMsThrow.vy) > 900,
  `a same-millisecond flick still throws, got ${JSON.stringify(sameMsThrow)}`);
assert.ok(Math.hypot(sameMsThrow.vx, sameMsThrow.vy) <= throwConst('THROW_MAX_SPEED'));
// …but a jump that happened long before the release is not movement either.
assert.equal(thrown.throwStillMoving([{ x: 0, y: 0, t: 0 }, { x: 90, y: 0, t: 20 }, { x: 90, y: 0, t: 300 }]), false);
// A slow, careful drag is a placement however long it went on for.
assert.equal(thrown.throwRelease([{ x: 0, y: 0, t: 0 }, { x: 20, y: 0, t: 100 }]), null);
assert.equal(thrown.throwRelease([{ x: 0, y: 0, t: 0 }]), null, 'one sample is not a gesture');
assert.equal(thrown.throwRelease([]), null);
// The window average still has to agree: a fast finish that was slow overall used to
// sneak through on one jittery sample pair.
assert.equal(thrown.throwRelease([
  { x: 0, y: 0, t: 0 }, { x: 2, y: 0, t: 50 }, { x: 4, y: 0, t: 90 }, { x: 34, y: 0, t: 95 },
]), null, 'the tail alone must not decide it either');

// The gesture buffer is bounded by *time*, not by a sample count. A fixed count is the
// mouse's report rate in disguise — 24 samples is 190 ms of gesture at 125 Hz and 24 ms
// at 1000 Hz, less than the window the judgement reads, and the pet quietly became
// unthrowable on a fast mouse.
const buffered = [];
for (let i = 0; i < 400; i++) thrown.throwRemember(buffered, i, 0, i);
assert.ok(buffered.length <= throwConst('THROW_BUFFER_MAX'), 'a 1000 Hz mouse cannot grow the buffer without bound');
assert.ok(buffered[buffered.length - 1].t - buffered[0].t >= throwConst('THROW_SAMPLE_MS'),
  'and the kept history still covers the whole window the judgement reads');
assert.ok(thrown.throwRelease(buffered), 'a gesture on a fast mouse is judged on its whole tail');
const lonely = [];
thrown.throwRemember(lonely, 1, 2, 3);
assert.deepEqual(throwJson(lonely), [{ x: 1, y: 2, t: 3 }], 'one sample is kept to start with');
thrown.throwRemember(lonely, Number.NaN, 0, 4);
assert.equal(lonely.length, 1, 'a sample that is not a number is not a position');
const aged = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 10 }];
thrown.throwRemember(aged, 2, 0, 5000);
assert.deepEqual(throwJson(aged), [{ x: 1, y: 0, t: 10 }, { x: 2, y: 0, t: 5000 }],
  'a drag that was left alone for five seconds starts again from the release');
assert.ok(aged.length >= 2, 'the buffer always keeps enough to describe a gesture');

// Friction is applied per unit of real time, so the same gesture glides the same
// distance on a 30 fps machine as on a 60 fps one.
const once = thrown.throwStep({ x: 0, y: 0, vx: 1000, vy: 0 }, toStep, box);
const twice = thrown.throwStep(thrown.throwStep({ x: 0, y: 0, vx: 1000, vy: 0 }, toStep / 2, box), toStep / 2, box);
assert.ok(Math.abs(once.vx - twice.vx) < 0.01, `${once.vx} vs ${twice.vx}`);
assert.ok(Math.abs(once.x - twice.x) < 0.2, `${once.x} vs ${twice.x}`);
assert.ok(once.vx < 1000 && once.vx > 985, 'and it decays a little every frame');

// The four walls reflect the velocity, scaled by the bounce factor.
const left = thrown.throwStep({ x: -99.9, y: 0, vx: -500, vy: 0 }, toStep, box);
assert.equal(left.hits.left, true);
assert.equal(left.x, box.minX, 'the pet is put back on the edge it crossed');
assert.ok(left.vx > 0, 'and sent the other way');
assert.ok(Math.abs(left.vx - 500 * 0.988 * 0.62) < 1, `bounce factor, got ${left.vx}`);
const right = thrown.throwStep({ x: 99.9, y: 0, vx: 500, vy: 0 }, toStep, box);
assert.equal(right.hits.right, true);
assert.ok(right.vx < 0);
const top = thrown.throwStep({ x: 0, y: -99.9, vx: 0, vy: -500 }, toStep, box);
assert.equal(top.hits.top, true);
assert.ok(top.vy > 0);
const bottom = thrown.throwStep({ x: 0, y: 99.9, vx: 0, vy: 500 }, toStep, box);
assert.equal(bottom.hits.bottom, true);
assert.ok(bottom.vy < 0);

// A stalled frame is clamped, so a hitch cannot tunnel the pet through a wall.
const stalled = thrown.throwStep({ x: 0, y: 0, vx: 1000, vy: 0 }, 5000, box);
assert.ok(stalled.x < box.maxX, `a 5 s frame must not cross the box, got ${stalled.x}`);

// The flight ends by itself, below the stop speed, and never leaves the box.
let flight = { x: 0, y: 0, vx: 2000, vy: 900 };
let steps = 0;
while (steps < 2000) {
  const next = thrown.throwStep(flight, toStep, box);
  flight = next;
  steps += 1;
  assert.ok(flight.x >= box.minX && flight.x <= box.maxX && flight.y >= box.minY && flight.y <= box.maxY,
    `escaped the box at step ${steps}`);
  if (next.settled) break;
}
assert.ok(steps < 2000, 'a throw has to come to rest on its own');
assert.equal(flight.vx, 0, 'and be left with no velocity at all');
assert.equal(flight.vy, 0);
const slow = thrown.throwStep({ x: 0, y: 0, vx: 30, vy: 0 }, toStep, box);
assert.equal(slow.settled, true, 'under the threshold the flight is over');
const fast = thrown.throwStep({ x: 0, y: 0, vx: 3000, vy: 0 }, toStep, box);
assert.equal(fast.settled, false);

// The bounce box comes from Rust, and a backend that cannot answer means "do not
// fly" rather than a guessed boundary.
assert.deepEqual(throwJson(thrown.throwBounds({ ok: true, minX: -100, minY: -170, maxX: 1720, maxY: 750 })),
  { minX: -100, minY: -170, maxX: 1720, maxY: 750 });
assert.equal(thrown.throwBounds({ ok: false, minX: 0, minY: 0, maxX: 0, maxY: 0 }), null);
assert.equal(thrown.throwBounds(null), null);
assert.equal(thrown.throwBounds({ ok: true, minX: 0, minY: 0, maxX: Number.NaN, maxY: 10 }), null);
// A window bigger than the work area gives a reversed box; it collapses to a point
// instead of letting `throwStep` clamp to an impossible range.
assert.deepEqual(throwJson(thrown.throwBounds({ ok: true, minX: 40, minY: 0, maxX: -10, maxY: -5 })),
  { minX: 40, minY: 0, maxX: 40, maxY: 0 });

// The lean is cosmetic, derived from the horizontal speed, and saturates.
assert.equal(thrown.throwTilt(0), 0);
assert.ok(Math.abs(thrown.throwTilt(900) - 0.34) < 1e-9);
assert.equal(thrown.throwTilt(900) + thrown.throwTilt(-900), 0, 'and it is symmetric');
assert.ok(Math.abs(thrown.throwTilt(99_999)) <= 0.34);
assert.equal(thrown.throwTilt(Number.NaN), 0);

assert.match(appSource, /throwRelease\(dragSamples\)/, 'one call makes the placement/throw call');
// The mouse-up position is part of the gesture: without it a pointer that stopped
// before letting go would still look like it was moving.
const mouseupAt = appSource.indexOf("window.addEventListener('mouseup'");
assert.ok(mouseupAt > 0, 'the pet window has to listen for the release');
const mouseupHandler = appSource.slice(mouseupAt, appSource.indexOf('});', mouseupAt));
assert.match(mouseupHandler, /sampleDrag\(event\.screenX, event\.screenY\)/,
  'the release has to be sampled, or a placement can still look like a flick');
assert.match(mouseupHandler, /release\(\)/);
assert.match(appSource, /throwStep\(flight,/);
assert.match(appSource, /throwBounds\(await window\.api\.flightBounds/);
assert.match(appSource, /leanForFlight\(state/);
assert.match(readFileSync(join(renderer, 'index.html'), 'utf8'), /lite-throw\.js/);
const throwApi = readFileSync(join(process.cwd(), 'src', 'renderer', 'lite-api.ts'), 'utf8');
assert.match(throwApi, /window_flight_bounds/, 'lite-api is missing the flight-bounds bridge');
const throwWindow = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'window.rs'), 'utf8');
assert.match(throwWindow, /pub fn window_flight_bounds/);
// One function owns the edge, so a drag and a throw can never disagree about it.
assert.match(throwWindow, /fn position_limits/);
assert.match(libSource, /window::window_flight_bounds/);

// ---- the airborne strip -----------------------------------------------------
// A thrown pet plays its own poses out of its own file. The generator behind it only
// ever *reads* bulu.png, which is what makes "the walking animation does not change"
// a property of the build instead of a promise.
const airbornePath = join(process.cwd(), 'dist', 'assets', 'animated-pets', 'bulu-airborne.png');
assert.ok(existsSync(airbornePath), 'the airborne strip has to ship next to the other atlases');
const airborneMeta = await sharp(airbornePath).metadata();
assert.equal(airborneMeta.height, actionCell, 'the airborne strip is one row of cells');
assert.equal(airborneMeta.width, actionCell * 4, 'four airborne poses');
assert.equal(airborneMeta.hasAlpha, true);
const airborneFrame = (col) => sharp(airbornePath)
  .extract({ left: col * actionCell, top: 0, width: actionCell, height: actionCell })
  .ensureAlpha().raw().toBuffer();
const airborneFrames = [await airborneFrame(0), await airborneFrame(1), await airborneFrame(2), await airborneFrame(3)];
for (const [index, frame] of airborneFrames.entries()) {
  let opaque = 0;
  let minX = actionCell, minY = actionCell, maxX = -1, maxY = -1;
  for (let pixel = 3; pixel < frame.length; pixel += 4) {
    if (frame[pixel] <= 16) continue;
    const at = pixel - 3;
    const x = (at / 4) % actionCell, y = Math.floor(at / 4 / actionCell);
    opaque++;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  assert.ok(opaque > 3000, `airborne frame ${index} is empty (${opaque} px)`);
  // A rotated pose that reaches the cell edge was clipped by the generator, which
  // fails its own build rather than shipping a sliced head.
  assert.ok(minX > 0 && minY > 0 && maxX < actionCell - 1 && maxY < actionCell - 1,
    `airborne frame ${index} touches its cell edge (${minX},${minY}..${maxX},${maxY})`);
}
assert.notDeepEqual(airborneFrames[0], airborneFrames[2], 'the airborne loop has to move');
// And it must not be the walking row: legs pedalling in mid-air was the bug.
for (const [index, frame] of airborneFrames.entries()) {
  for (let column = 0; column < 4; column++) {
    assert.notDeepEqual(frame, await sheetFrame(1, column),
      `airborne frame ${index} is a copy of walking pose ${column}`);
  }
}
assert.match(appSource, /buluAirborne/);
assert.match(appSource, /AIRBORNE_FRAME_MS/);
assert.match(readFileSync(join(process.cwd(), 'scripts', 'copy-assets.mjs'), 'utf8'), /bulu-airborne\.png/);
const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
assert.match(packageJson.scripts['bulu-art'], /build-bulu-airborne\.mjs/,
  'npm run bulu-art has to rebuild the airborne strip too');
assert.ok(existsSync(join(process.cwd(), 'scripts', 'build-bulu-airborne.mjs')));
assert.match(readFileSync(join(process.cwd(), 'scripts', 'build-bulu-airborne.mjs'), 'utf8'),
  /must only read it/, 'the generator has to prove bulu.png came out unchanged');
// The strip is built smaller than the walking art so a rotated pose fits its cell,
// and the renderer draws it that much larger to keep the pet the same size. Two
// numbers in two files have to agree, so they are checked against each other.
const generatorSource = readFileSync(join(process.cwd(), 'scripts', 'build-bulu-airborne.mjs'), 'utf8');
const fitScale = Number(/const FIT_SCALE = ([\d.]+);/.exec(generatorSource)?.[1]);
assert.ok(fitScale > 0.5 && fitScale < 1, `unreadable FIT_SCALE in the generator: ${fitScale}`);
// The renderer draws the strip `1 / scale` larger, so its divisor has to be the
// generator's scale — the same number written in two files, checked here.
const drawDivisor = Number(/const AIRBORNE_DRAW_SCALE = 1 \/ ([\d.]+);/.exec(appSource)?.[1]);
assert.ok(Math.abs(drawDivisor - fitScale) < 1e-9,
  `the strip is generated at ${fitScale} but the renderer compensates for ${drawDivisor}`);
console.log('Weekly summary (week totals, streak, verdict): passed');
console.log('Pet packs (frames, grid, wiring, dictionary): passed');
console.log('Thrown pet: release judgement, friction, four walls, airborne strip: passed');

console.log('Lightweight image validation (cutout lives in Rust): passed');
console.log('Lightweight package contents: passed');
console.log('File-drop reactions by type: passed');
console.log('Language switching (zh / en): passed');
