// ============================================================================
// Drives the cutout mask editor against a fake DOM: brush composites, the
// undo/redo snapshots, the re-run path and the export all have to be wired to
// the right canvas operations. A real browser window is not available in CI, and
// this is the part of the feature that cannot be checked from Rust.
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { zhDict } = require(join(process.cwd(), 'dist', 'shared', 'i18n.js'));

const events = new Map();
const windowEvents = new Map();
const elements = new Map();
const contexts = [];
const calls = { mask: [], commits: [], closed: 0 };
let snapshots = 0;
let frame = null;
let maskReload = () => {};
let configChanged = () => {};

function makeContext(canvas) {
  const context = {
    canvas,
    ops: [],
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    setTransform() {},
    clearRect() {},
    drawImage(...args) {
      this.ops.push({ op: 'draw', composite: this.globalCompositeOperation, args });
    },
    fillRect(...args) { this.ops.push({ op: 'fill', composite: this.globalCompositeOperation, color: this.fillStyle, args }); },
    strokeRect() {},
    beginPath() {},
    arc() {},
    stroke() {},
    createRadialGradient() { return { addColorStop() {} }; },
    getImageData(x, y, w, h) {
      snapshots++;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), snapshot: snapshots };
    },
    putImageData(image) { this.ops.push({ op: 'put', image }); },
  };
  contexts.push(context);
  return context;
}

function makeCanvas(id) {
  const canvas = Object.assign(makeElement(id), {
    width: 0, height: 0,
    getContext: () => makeContext(canvas),
    toDataURL: () => 'data:image/png;base64,MOCK',
  });
  return canvas;
}

function makeElement(id) {
  const element = {
    id, value: '', checked: false, disabled: false, textContent: '', style: {},
    clientWidth: 800, clientHeight: 600,
    classList: { active: false, toggle(_name, on) { this.active = !!on; } },
    addEventListener(name, callback) { events.set(`${id}:${name}`, callback); },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  return element;
}

const ranges = { 'brush-size': [4, 240, 48], 'brush-hardness': [0, 100, 65], 'cutout-strength': [8, 60, 25], 'cutout-feather': [0, 4, 1] };
const ids = ['stage', 'mask-view', 'mask-status', 'mask-note', 'before-preview', 'after-preview', 'apply', 'undo', 'redo',
  'rerun', 'start-over', 'tool-erase', 'tool-restore', 'brush-size', 'size-value', 'brush-hardness', 'hardness-value', 'cutout-strength',
  'strength-value', 'cutout-feather', 'feather-value', 'show-original', 'close', 'cancel', 'fit', 'zoom-in', 'zoom-out'];
for (const id of ids) elements.set(id, ['mask-view', 'before-preview', 'after-preview'].includes(id) ? makeCanvas(id) : makeElement(id));
for (const [id, [min, max, value]] of Object.entries(ranges)) {
  Object.assign(elements.get(id), { min, max, value });
}
elements.get('apply').disabled = true;

class FakeImage {
  naturalWidth = 6;
  naturalHeight = 6;
  set src(value) { this._src = value; queueMicrotask(() => this.onload && this.onload()); }
  get src() { return this._src; }
}

const api = {
  getI18n: async () => ({ locale: 'zh', dict: zhDict }),
  // The editor only uses it to tell a real language change from a config update.
  getConfig: async () => ({ locale: 'zh' }),
  maskPreview: async (tolerance, feather) => {
    calls.mask.push({ tolerance, feather });
    return { ok: true, width: 4, height: 4, original: 'data:image/png;base64,ORIGINAL',
      mask: 'data:image/png;base64,MASK', subject: 0.25, applied: true, rejected: false };
  },
  commitCustomImage: async (removeBackground, png) => {
    calls.commits.push({ removeBackground, png });
    return { ok: true };
  },
  closeMaskEditor: () => { calls.closed++; },
  onMaskReload: (callback) => { maskReload = callback; return () => {}; },
  onConfigChanged: (callback) => { configChanged = callback; return () => {}; },
};

const browser = {
  api, devicePixelRatio: 1,
  requestAnimationFrame(callback) { frame = callback; return 1; },
  addEventListener(name, callback) { windowEvents.set(name, callback); },
};
const context = {
  window: browser,
  document: {
    createElement: (tag) => makeCanvas(tag),
    getElementById: (id) => elements.get(id),
    documentElement: {},
    querySelectorAll: () => [],
  },
  Image: FakeImage, ResizeObserver: class { observe() {} },
  Math, Number, String, Promise, Error, Uint8ClampedArray, console,
};
vm.createContext(context);
for (const file of ['lite-i18n.js', 'lite-image.js', 'lite-mask.js']) {
  vm.runInContext(readFileSync(join(process.cwd(), 'dist', 'renderer', file), 'utf8'), context);
}
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();
await settle();

const apply = elements.get('apply');
const undo = elements.get('undo');
const redo = elements.get('redo');
const erase = elements.get('tool-erase');
const restore = elements.get('tool-restore');
const dispatch = (target, name, event = {}) => events.get(`${target}:${name}`)({
  button: 0, pointerId: 1, clientX: 300, clientY: 300, preventDefault() {}, ...event });
const drawOps = () => contexts.flatMap(c => c.ops);
const maskContext = () => contexts.find(c => c.ops.some(o => o.composite === 'destination-out'));

// The staged picture is segmented on load and the editor becomes usable.
assert.deepEqual(calls.mask[0], { tolerance: 25, feather: 1 }, 'the stored strength / feather seed the first pass');
assert.equal(apply.disabled, false, 'a loaded mask enables the apply button');
assert.equal(undo.disabled, true, 'nothing to undo before the first stroke');

// Erase brush: stamps cut the mask alpha out.
dispatch('mask-view', 'pointerdown');
dispatch('mask-view', 'pointermove', { buttons: 1, clientX: 340, clientY: 340 });
dispatch('mask-view', 'pointerup', { clientX: 340, clientY: 340 });
const maskCtx = maskContext();
assert.ok(maskCtx, 'the erase brush has to use destination-out');
assert.ok(maskCtx.ops.filter(o => o.op === 'draw').length >= 2, 'a drag stamps along the path');
assert.equal(undo.disabled, false, 'a finished stroke is undoable');

// Restore brush: the same dabs paint white back into the mask.
maskCtx.ops.length = 0;
dispatch('tool-restore', 'click');
assert.equal(restore.classList.active, true);
dispatch('mask-view', 'pointerdown', { clientX: 320, clientY: 320 });
dispatch('mask-view', 'pointerup', { clientX: 320, clientY: 320 });
assert.ok(maskCtx.ops.some(o => o.op === 'draw' && o.composite === 'source-over'),
  'the restore brush paints back over the erase');

// Undo puts the pre-stroke pixels back; redo re-applies the stroke.
frame();
const scratchCtx = contexts.find(c => c.ops.some(o => o.op === 'draw' && o.composite === 'destination-in'));
assert.ok(scratchCtx, 'the stage composites the picture through the mask');
const beforeStrokes = snapshots;
scratchCtx.ops.length = 0;
dispatch('undo', 'click');
const undoPut = maskCtx.ops.filter(o => o.op === 'put').at(-1);
assert.ok(undoPut, 'undo has to write the remembered pixels back');
assert.ok(undoPut.image.snapshot <= beforeStrokes, 'undo restores the snapshot taken before the stroke');
// The stage has to be recomposited, otherwise it keeps showing the pixels the
// user just took back.
frame();
assert.ok(scratchCtx.ops.some(o => o.op === 'draw' && o.composite === 'destination-in'),
  'undo recomposites the preview');
dispatch('undo', 'click');
assert.equal(undo.disabled, true, 'undo walks back through the whole stack');
const putsBefore = maskCtx.ops.filter(o => o.op === 'put').length;
dispatch('redo', 'click');
assert.equal(maskCtx.ops.filter(o => o.op === 'put').length, putsBefore + 1, 'redo writes the post-stroke pixels');
assert.equal(undo.disabled, false, 'redo puts the entry back on the undo stack');

// Keyboard shortcuts mirror the toolbar.
windowEvents.get('keydown')({ key: 'e', preventDefault() {} });
assert.equal(erase.classList.active, true, 'E selects the erase brush');
windowEvents.get('keydown')({ key: ']', preventDefault() {} });
assert.equal(Number(elements.get('brush-size').value), 56, '] grows the brush');

// "Run it again" re-segments with the current sliders and stays undoable.
const reruns = calls.mask.length;
elements.get('cutout-strength').value = '40';
elements.get('cutout-feather').value = '3';
dispatch('rerun', 'click');
await settle();
assert.equal(calls.mask.length, reruns + 1, 'the re-run button asks the backend again');
assert.deepEqual(calls.mask.at(-1), { tolerance: 40, feather: 3 }, 'the sliders drive the second pass');
assert.ok(maskCtx.ops.some(o => o.op === 'put'), 'a re-run is undoable like a stroke');

// Starting from the original discards the automatic holes but keeps the reset
// undoable, so a difficult photo can be cut out entirely by hand.
elements.get('show-original').checked = true;
maskCtx.ops.length = 0;
dispatch('start-over', 'click');
assert.ok(maskCtx.ops.some(o => o.op === 'fill' && o.color === '#fff'),
  'start from original must fill the whole keep-mask');
assert.equal(elements.get('show-original').checked, false, 'the editor must show the restored result');
assert.equal(erase.classList.active, true, 'manual cutout should select the erase brush');
assert.match(elements.get('mask-note').textContent, /已恢复完整原图/);
assert.equal(undo.disabled, false, 'the reset must be undoable');

// Another import while the editor is open reloads the picture.
maskReload();
await settle();
assert.equal(calls.mask.length, reruns + 2, 'a new import reloads the mask window');

// Export: the composited PNG is handed to Rust, then the window closes itself.
dispatch('apply', 'click');
await settle();
assert.equal(calls.commits.length, 1, 'apply saves the composited result');
assert.equal(calls.commits[0].removeBackground, false, 'a composited PNG must not be keyed again');
assert.match(calls.commits[0].png, /^data:image\/png/, 'the editor exports a PNG data URL');
assert.equal(calls.closed, 1, 'the editor closes after a successful save');

// The preview hint reports the detected subject and follows the dictionary.
assert.match(elements.get('mask-note').textContent, /主体约占 25%/);
configChanged({ locale: 'en' });
await settle();
assert.match(elements.get('mask-note').textContent, /主体约占 25%/, 'the hint survives a language switch');

console.log('Cutout mask editor: brush, history, re-run and export: passed');
