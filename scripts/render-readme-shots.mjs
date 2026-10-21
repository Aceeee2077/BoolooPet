// ============================================================================
// Regenerates the README screenshots in docs/screenshots/.
//
// The pet window and the settings panel are Tauri webviews, and the panel is
// plain HTML + CSS, so rendering the shipped page against a stub backend is an
// honest picture of the UI — including its zh / en switch, which is why every
// image exists twice. The desktop picture is a simulated desktop (the pet is a
// transparent always-on-top window; a real screen capture would need a DWM
// composition pass).
//
// Usage:
//   npm run screenshots            # both languages
//   npm run screenshots -- en      # English only
//   npm run screenshots -- zh      # Chinese only
//
// Needs `npm run build` first (it renders dist/renderer/*) and a local Chrome or
// Edge; set BOOLOO_CHROME to point at one explicitly.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = join(ROOT, 'dist', 'renderer');
const OUT = join(ROOT, 'docs', 'screenshots');
const I18N = join(ROOT, 'src-tauri', 'resources', 'i18n.json');

const CANDIDATES = [
  process.env.BOOLOO_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const browser = CANDIDATES.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('No Chrome or Edge found. Set BOOLOO_CHROME to the executable.');
  process.exit(1);
}
if (!existsSync(join(RENDERER, 'settings.html'))) {
  console.error('dist/renderer is missing — run `npm run build` first.');
  process.exit(1);
}

const requested = process.argv.slice(2).filter((arg) => arg === 'zh' || arg === 'en');
const languages = requested.length ? requested : ['zh', 'en'];
// The settings window's real size (see build_settings in src-tauri/src/window.rs).
// The panel is a fixed-height paged column now, so the shot has to use the same
// viewport the app opens with — a different height would show the rail and the
// pages laid out against a window the user never sees.
const SETTINGS_WIDTH = 960;
const SETTINGS_HEIGHT = 720;
const dictionary = JSON.parse(readFileSync(I18N, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'booloo-shots-'));

/**
 * Chrome's new headless mode still draws its own window frame, so `--window-size`
 * is smaller than the viewport by a constant. Measure that once so the shots are
 * exactly the size the app opens with instead of a guessed padding.
 */
function frameShortfall() {
  const file = join(scratch, 'frame.html');
  writeFileSync(file, '<!doctype html><meta charset="utf-8"><body><script>'
    + "document.body.textContent = innerWidth + 'x' + innerHeight;</script></body>", 'utf8');
  const dom = execFileSync(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${join(scratch, 'profile-frame')}`,
    '--virtual-time-budget=1000',
    '--window-size=1000,800',
    '--dump-dom',
    `file:///${file.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const match = /<body>(\d+)x(\d+)<\/body>/.exec(dom);
  if (!match) throw new Error('could not measure the headless window frame');
  return { width: 1000 - Number(match[1]), height: 800 - Number(match[2]) };
}
const frame = frameShortfall();
const windowSize = (width, height) => `${width + frame.width},${height + frame.height}`;

/**
 * A screenshot of `file` with a `width`x`height` viewport, written to `target`.
 *
 * Screenshot mode lays the page out at the full `--window-size` (unlike
 * `--dump-dom`, which keeps a frame's worth of window chrome), so no
 * compensation is needed here — the image is the viewport, pixel for pixel.
 */
function shoot(file, width, height, target) {
  // Chrome refuses to share a profile between runs, so every shot gets its own.
  const profile = `profile-${target.slice(target.lastIndexOf('\\') + 1).replace(/[^\w.-]/g, '_')}`;
  execFileSync(browser, [
    '--headless=new',
    // Chrome's own sandbox cannot start inside every CI/agent shell.
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${join(scratch, profile)}`,
    '--virtual-time-budget=2500',
    `--window-size=${width},${height}`,
    `--screenshot=${target}`,
    `file:///${file.replace(/\\/g, '/')}`,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  return target;
}

/** The DOM after the page settles — used to prove the right language rendered. */
function settledDom(file, width, height) {
  return execFileSync(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    ...(width ? [`--window-size=${windowSize(width, height ?? 720)}`] : []),
    `--user-data-dir=${join(scratch, 'profile-dom')}`,
    '--virtual-time-budget=2500',
    '--dump-dom',
    `file:///${file.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * The stub backend: lite-api.ts talks to `window.__TAURI__.core.invoke`, so the
 * pages run their real code paths against a fixed config + the real dictionary.
 */
function stubSource(locale) {
  // A deterministic click history for the shot: without one the heatmap renders
  // as an empty year and the screenshots cannot show what the shades mean. The
  // pattern keeps weekday peaks and quiet weekends, and covers every bucket.
  const dailyStats = {};
  const activeDays = [];
  const today = new Date();
  for (let back = 199; back >= 0; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const wave = Math.sin(back / 9) * 60 + Math.sin(back / 3.5) * 35;
    // Tuned to the heatmap's thresholds (10 / 40 / 70 / 100) so the shot spreads
    // across all four shades instead of saturating at the darkest one.
    const clicks = Math.max(0, Math.round((weekend ? 12 : 55) + wave - (back > 170 ? 35 : 0)));
    if (clicks) dailyStats[key] = { clicks };
    if (clicks) activeDays.push(key);
  }
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  dailyStats[todayKey] = { ...(dailyStats[todayKey] ?? {}), stand: 3, eye: 5, water: 2 };
  const config = {
    skin: 'bulu',
    currentPetId: 'bulu',
    petScale: 1,
    opacity: 0.95,
    autoMove: true,
    fileDropReactions: true,
    standReminderEnabled: true,
    standReminderMinutes: 10,
    eyeRestEnabled: true,
    eyeRestMinutes: 20,
    waterEnabled: true,
    waterMinutes: 45,
    hourlyChime: true,
    // A pet that has been around for a while, so the affinity section shows a
    // real level rather than an empty bar.
    affinity: 260,
    statsFirstSeen: activeDays[0] ?? todayKey,
    statsDays: activeDays,
    statsClicks: 1240,
    dailyStats,
    locale,
  };
  return `window.__TAURI__ = (() => {
  let config = ${JSON.stringify(config)};
  const dict = ${JSON.stringify(dictionary)};
  const results = {
    config_get: () => config,
    config_set: ({ patch }) => (config = { ...config, ...patch }),
    i18n_get: () => ({ locale: config.locale, dict: dict[config.locale] || dict.zh }),
    autolaunch_get: () => config.autoLaunch === true,
    autolaunch_set: ({ enabled }) => (config.autoLaunch = enabled),
    custom_get: () => ({ ok: false }),
    // The settings panel paints the update row on load; without this the shot
    // would show the panel's "could not load settings" error line.
    update_get_state: () => ({
      status: 'up-to-date', currentVersion: '0.6.5',
      autoCheck: true, autoDownload: true, channel: 'stable',
    }),
  };
  return {
    core: {
      convertFileSrc: (path) => path,
      invoke: async (name, args) => (results[name] ? results[name](args || {}) : null),
    },
    event: { listen: async () => () => {} },
  };
})();
`;
}

function settingsPage(locale) {
  const page = join(scratch, `settings-${locale}.html`);
  const html = readFileSync(join(RENDERER, 'settings.html'), 'utf8');
  // The stub has to win the race against the first `getI18n` call.
  // The real settings window is transparent over the desktop, so the page gets a
  // wallpaper for the shot: without one there is nothing for the glass card to
  // tint and the effect would not be visible in the README image.
  writeFileSync(page, html
    .replace('<script src="./lite-i18n.js"></script>',
      '<script src="./stub.js"></script>\n  <script src="./lite-i18n.js"></script>')
    .replace('</head>',
      '  <style>html { background: linear-gradient(135deg, #d9e6f5 0%, #eef2f7 46%, #f7e2cf 100%); }</style>\n</head>'),
    'utf8');
  return page;
}

/** A simulated desktop: wallpaper, a window, the taskbar and the pet on top. */
function desktopPage(locale) {
  const greeting = (dictionary[locale] || {})['bubble.greeting'] || 'Bulu';
  const html = `<!doctype html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 900px; height: 520px; overflow: hidden;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  body { background: linear-gradient(135deg, #f2f6fb 0%, #e2eaf4 52%, #d3dfee 100%); }
  .window { position: absolute; left: 52px; top: 34px; width: 656px; height: 386px;
    background: #fff; border-radius: 14px;
    box-shadow: 0 20px 48px rgba(58, 78, 108, .16), 0 2px 6px rgba(58, 78, 108, .07); }
  .titlebar { display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 16px;
    border-bottom: 1px solid #eef1f6; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #e4e9f0; }
  .dot.a { background: #f2c4c1; } .dot.b { background: #f5e0b9; } .dot.c { background: #c9e6cf; }
  .body { display: flex; gap: 26px; padding: 22px 26px; }
  .lines { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .bar { height: 10px; border-radius: 5px; background: #eef1f6; }
  .art { width: 208px; height: 208px; border-radius: 12px; background: #f3f6fa; }
  .taskbar { position: absolute; left: 0; bottom: 0; display: flex; align-items: center;
    gap: 12px; width: 100%; height: 46px; padding: 0 20px;
    background: rgba(255, 255, 255, .78); border-top: 1px solid rgba(255, 255, 255, .95); }
  .icon { width: 26px; height: 26px; border-radius: 8px; background: #e6ecf4; }
  .icon.cat { background: #f7dcc8; } .icon.warm { background: #f9e6d3; }
  .bubble { position: absolute; left: 402px; top: 176px; max-width: 268px;
    padding: 13px 17px; border-radius: 16px; background: #fff; color: #513a2c;
    font-size: 16px; line-height: 1.35;
    box-shadow: 0 12px 30px rgba(58, 78, 108, .15); }
  .bubble::after { content: ""; position: absolute; right: 46px; bottom: -8px;
    width: 18px; height: 18px; border-radius: 3px; background: #fff; transform: rotate(45deg); }
  .pet { position: absolute; left: 556px; top: 286px; width: 196px; height: 196px;
    background-image: url(./pet.png); background-size: 400% 400%; background-position: 0 0;
    filter: drop-shadow(0 14px 18px rgba(40, 60, 90, .26)); }
</style></head><body>
  <div class="window">
    <div class="titlebar"><span class="dot a"></span><span class="dot b"></span><span class="dot c"></span></div>
    <div class="body">
      <div class="lines">
        <div class="bar" style="width: 74%"></div>
        <div class="bar" style="width: 92%"></div>
        <div class="bar" style="width: 58%"></div>
        <div class="bar" style="width: 83%"></div>
        <div class="bar" style="width: 40%"></div>
      </div>
      <div class="art"></div>
    </div>
  </div>
  <div class="taskbar">
    <span class="icon cat"></span><span class="icon"></span><span class="icon warm"></span>
    <span class="icon"></span><span class="icon"></span>
  </div>
  <div class="bubble">${greeting}</div>
  <div class="pet"></div>
</body></html>`;
  const page = join(scratch, `desktop-${locale}.html`);
  writeFileSync(page, html, 'utf8');
  return page;
}

copyFileSync(join(ROOT, 'src', 'assets', 'animated-pets', 'bulu.png'), join(scratch, 'pet.png'));
for (const asset of ['lite-i18n.js', 'lite-day.js', 'lite-affinity.js', 'lite-care.js', 'lite-api.js', 'lite-image.js', 'lite-summary.js', 'lite-report.js', 'lite-pack.js', 'lite-pack-editor.js', 'lite-settings.js', 'lite-settings.css']) {
  copyFileSync(join(RENDERER, asset), join(scratch, asset));
}

const checks = {
  zh: { expect: ['选择桌宠', '宠物大小', '透明度', '站立提醒'], reject: ['Pet size', 'Opacity'] },
  en: { expect: ['Choose your pet', 'Pet size', 'Opacity', 'Standing reminder'], reject: ['选择桌宠', '宠物大小'] },
};

/**
 * The page's own layout numbers, read back through the DOM.
 *
 * The panel height used to be found by scanning the screenshot for anything that
 * was not the panel's `#fff8f2`, which stopped working the moment the panel became
 * a translucent card. Asking the page is both simpler and gives the heatmap's
 * width, so a grid that no longer fits the window fails the shot instead of
 * quietly shipping a clipped picture.
 */
async function layoutMetrics(file, width, height) {
  const suffix = Math.random().toString(36).slice(2);
  const probe = join(scratch, `metrics-${suffix}.html`);
  // The probe is a separate file rather than an inline <script>: the settings page
  // ships `script-src 'self'`, so an inline block is refused before it runs.
  // Measurement is driven by a DOM mutation rather than a timer because headless
  // Chrome's virtual time does not advance while the panel's slow background
  // animation is running, so `setTimeout` would never fire before the dump.
  writeFileSync(join(scratch, `probe-${suffix}.js`), `
(() => {
  // Page errors are recorded too: without them a failed shot only says "no
  // metrics", which says nothing about what actually broke.
  const fail = (message) => {
    const out = document.createElement('pre');
    out.id = 'booloo-error';
    out.textContent = String(message);
    document.body.append(out);
  };
  window.addEventListener('error', (event) => fail(event.message));
  window.addEventListener('unhandledrejection', (event) => fail(event.reason));
  const report = () => {
    // The panel is paged now, and the heatmap lives on a page that starts
    // hidden — switch to it, or every box below measures as zero.
    const records = document.querySelector('[data-page-target="records"]');
    if (records) records.click();
    const panel = document.querySelector('.panel');
    const scroll = document.querySelector('.heatmap-scroll');
    const grid = document.getElementById('heatmap-grid');
    const cell = document.querySelector('.heatmap-cell');
    const measured = {
      panelWidth: Math.ceil(panel.getBoundingClientRect().width),
      panelHeight: Math.ceil(panel.getBoundingClientRect().height),
      pageWidth: Math.ceil(document.documentElement.clientWidth),
      headerWidth: Math.ceil(document.querySelector('header').getBoundingClientRect().width),
      heatmapCells: grid.children.length,
      cellSize: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
      gridWidth: Math.ceil(grid.getBoundingClientRect().width),
      // Where the chart sits in the page, so a preview can be cropped to it.
      heatmapTop: Math.ceil(document.getElementById('heatmap').getBoundingClientRect().top + window.scrollY),
      viewportWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
    };
    const out = document.createElement('pre');
    out.id = 'booloo-metrics';
    out.textContent = JSON.stringify(measured);
    document.body.append(out);
  };
  const grid = document.getElementById('heatmap-grid');
  if (grid.children.length) { report(); return; }
  const observer = new MutationObserver(() => {
    if (!grid.children.length) return;
    observer.disconnect();
    report();
  });
  observer.observe(grid, { childList: true });
})();
`, 'utf8');
  const html = readFileSync(file, 'utf8')
    .replace('</body>', `  <script src="./probe-${suffix}.js"></script>\n</body>`);
  writeFileSync(probe, html, 'utf8');
  const dom = settledDom(probe, width, height);
  const match = /<pre id="booloo-metrics">([^<]*)<\/pre>/.exec(dom);
  if (!match) {
    const error = /<pre id="booloo-error">([^<]*)<\/pre>/.exec(dom);
    throw new Error(`the settings page did not report its layout metrics${error ? `: ${error[1]}` : ''}`);
  }
  return JSON.parse(match[1]);
}

mkdirSync(OUT, { recursive: true });
for (const locale of languages) {
  writeFileSync(join(scratch, 'stub.js'), stubSource(locale), 'utf8');
  const suffix = locale === 'en' ? '-en' : '';

  const settingsFile = settingsPage(locale);
  const dom = settledDom(settingsFile, SETTINGS_WIDTH, SETTINGS_HEIGHT);
  for (const text of checks[locale].expect) {
    if (!dom.includes(text)) throw new Error(`settings page did not render "${text}" for ${locale}`);
  }
  for (const text of checks[locale].reject) {
    if (dom.includes(text)) throw new Error(`settings page leaked "${text}" into ${locale}`);
  }
  // Shot at the window's real size (see build_settings) so the picture shows the
  // layout the app actually opens with.
  const layout = await layoutMetrics(settingsFile, SETTINGS_WIDTH, SETTINGS_HEIGHT);
  // The glass has to fill the window: a narrower card leaves a transparent ring
  // around it, which is what "there is an obvious gap at the outermost edge"
  // was about.
  if (layout.pageWidth - layout.panelWidth > 1) {
    throw new Error(`the glass card is ${layout.panelWidth}px in a ${layout.pageWidth}px window`);
  }
  // The title bar has to span the card (bar its 1px border on each side); a
  // narrower header is the "why is the top strip a different width" bug.
  if (layout.panelWidth - layout.headerWidth > 2) {
    throw new Error(`the title bar is ${layout.headerWidth}px wide inside a ${layout.panelWidth}px card`);
  }
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    throw new Error(`the click heatmap overflows: ${layout.scrollWidth}px of grid in ${layout.viewportWidth}px`);
  }
  // A calendar year is 52–54 whole weeks plus the weekday gutter, and the grid
  // carries a header row on top of the seven day rows.
  const heatmapColumns = layout.heatmapCells / 8;
  if (!Number.isInteger(heatmapColumns) || heatmapColumns < 53 || heatmapColumns > 55) {
    throw new Error(`the heatmap drew ${layout.heatmapCells} cells, which is not a year of weeks`);
  }
  console.log(`  热力图 ${layout.gridWidth}px / 可用 ${layout.viewportWidth}px，` +
    `${layout.heatmapCells} 格 × ${layout.cellSize}px；面板 ${layout.panelWidth}×${layout.panelHeight}` +
    `（窗口 ${layout.pageWidth}，标题栏 ${layout.headerWidth}），` +
    `热力图在 y=${layout.heatmapTop}`);
  // The panel is exactly one window tall now (the pages scroll inside it), so
  // the shot is the window, not the panel plus a margin.
  if (layout.panelHeight !== SETTINGS_HEIGHT) {
    throw new Error(`the card is ${layout.panelHeight}px tall in a ${SETTINGS_HEIGHT}px window`);
  }
  console.log(`✓ docs/screenshots/lightweight-settings${suffix}.png (${locale})`,
    shoot(settingsFile, SETTINGS_WIDTH, SETTINGS_HEIGHT, join(OUT, `lightweight-settings${suffix}.png`)));

  console.log(`✓ docs/screenshots/lightweight-pet${suffix}.png (${locale})`,
    shoot(desktopPage(locale), 900, 520, join(OUT, `lightweight-pet${suffix}.png`)));
}

console.log(`\nDone — rendered with ${browser}`);
console.log(`Scratch files kept in ${scratch}`);
