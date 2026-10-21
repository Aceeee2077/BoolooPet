// ============================================================================
// Cutout mask editor.
//
// The Rust pass (`custom_mask_preview`) segments the staged photo and hands this
// window the picture plus an initial keep-mask. Everything here is brush work on
// that mask:
//
//   * the mask canvas holds white with the keep factor in its alpha channel, so
//     "erase" is `destination-out` and "restore" paints white back;
//   * a stroke is stamped along the interpolated pointer path with a radial-gradient
//     sprite, which is what gives the hardness / feather slider its meaning;
//   * undo / redo store only the pixels a stroke actually touched, so a long
//     session on a big photo stays affordable;
//   * "use this image" composites picture x mask and hands the PNG to Rust, which
//     writes it as the custom appearance.
// ============================================================================
(() => {
  type Tool = 'erase' | 'restore';
  interface Rect { x: number; y: number; width: number; height: number }
  interface HistoryEntry { rect: Rect; before: ImageData; after: ImageData }
  interface NoteState { key: string; params?: Record<string, number> }

  const MAX_HISTORY = 24;
  const MAX_HISTORY_BYTES = 96 * 1024 * 1024;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 8;

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = el<HTMLDivElement>('stage');
  const view = el<HTMLCanvasElement>('mask-view');
  const viewCtx = view.getContext('2d')!;
  const statusEl = el<HTMLParagraphElement>('mask-status');
  const noteEl = el<HTMLParagraphElement>('mask-note');
  const beforeThumb = el<HTMLCanvasElement>('before-preview');
  const afterThumb = el<HTMLCanvasElement>('after-preview');
  const applyButton = el<HTMLButtonElement>('apply');
  const undoButton = el<HTMLButtonElement>('undo');
  const redoButton = el<HTMLButtonElement>('redo');
  const rerunButton = el<HTMLButtonElement>('rerun');
  const startOverButton = el<HTMLButtonElement>('start-over');
  const eraseButton = el<HTMLButtonElement>('tool-erase');
  const restoreButton = el<HTMLButtonElement>('tool-restore');
  const sizeInput = el<HTMLInputElement>('brush-size');
  const sizeValue = el<HTMLOutputElement>('size-value');
  const hardnessInput = el<HTMLInputElement>('brush-hardness');
  const hardnessValue = el<HTMLOutputElement>('hardness-value');
  const strengthInput = el<HTMLInputElement>('cutout-strength');
  const strengthValue = el<HTMLOutputElement>('strength-value');
  const featherInput = el<HTMLInputElement>('cutout-feather');
  const featherValue = el<HTMLOutputElement>('feather-value');
  const originalInput = el<HTMLInputElement>('show-original');

  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d')!;
  let strokeBase: HTMLCanvasElement | null = null;

  /** Working-resolution original, composited with `mask` for both view and export. */
  let base: HTMLCanvasElement | null = null;
  /** Keep-mask: white, with the keep factor in the alpha channel. */
  let mask: HTMLCanvasElement | null = null;
  let maskCtx: CanvasRenderingContext2D | null = null;
  let width = 0;
  let height = 0;

  let tool: Tool = 'erase';
  let brushSize = 48;
  let brushHardness = 0.65;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pointerInside = false;
  let pointerX = 0;
  let pointerY = 0;
  let painting = false;
  let panning = false;
  let spaceHeld = false;
  let panOrigin = { x: 0, y: 0, panX: 0, panY: 0 };
  let lastPoint: { x: number; y: number } | null = null;
  let strokeRect: Rect | null = null;
  let compositeDirty = true;
  let thumbsDirty = true;
  let frameHandle = 0;
  let loading = false;
  let noteState: NoteState = { key: 'lite.mask.pending' };
  const history: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let historyBytes = 0;

  let sprite: HTMLCanvasElement | null = null;
  let spriteKey = '';

  function setStatus(text: string, error = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', error);
  }

  function updateNote() {
    noteEl.textContent = liteT(noteState.key, noteState.params);
  }

  function updateReadouts() {
    sizeValue.textContent = `${Math.round(brushSize)} px`;
    hardnessValue.textContent = `${Math.round(brushHardness * 100)}%`;
    strengthValue.textContent = strengthInput.value;
    featherValue.textContent = `${featherInput.value} px`;
  }

  function updateButtons() {
    undoButton.disabled = history.length === 0;
    redoButton.disabled = redoStack.length === 0;
    applyButton.disabled = loading || !mask;
    startOverButton.disabled = loading || !mask;
  }

  // ---------- view transform ----------

  function fitScale() {
    return Math.min(stage.clientWidth / Math.max(1, width), stage.clientHeight / Math.max(1, height));
  }

  /** Screen placement of the image inside the stage, in CSS pixels. */
  function transform() {
    const scale = fitScale() * zoom;
    return {
      scale,
      ox: (stage.clientWidth - width * scale) / 2 + panX,
      oy: (stage.clientHeight - height * scale) / 2 + panY,
    };
  }

  function viewPoint(clientX: number, clientY: number) {
    const rect = view.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function imagePoint(clientX: number, clientY: number) {
    const point = viewPoint(clientX, clientY);
    const place = transform();
    return { x: (point.x - place.ox) / place.scale, y: (point.y - place.oy) / place.scale };
  }

  // ---------- painting ----------

  /** Radial-gradient stamp: opacity 1 out to `hardness`, then a soft rim. */
  function brushSprite() {
    const key = `${Math.round(brushSize)}|${brushHardness.toFixed(2)}`;
    if (sprite && spriteKey === key) return sprite;
    const size = Math.max(2, Math.round(brushSize));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const radius = size / 2;
    const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    const solid = Math.min(0.96, Math.max(0, brushHardness));
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    if (solid > 0.01) gradient.addColorStop(solid, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    sprite = canvas;
    spriteKey = key;
    return canvas;
  }

  function growStrokeRect(x: number, y: number, w: number, h: number) {
    if (!strokeRect) {
      strokeRect = { x, y, width: w, height: h };
      return;
    }
    const right = Math.max(strokeRect.x + strokeRect.width, x + w);
    const bottom = Math.max(strokeRect.y + strokeRect.height, y + h);
    strokeRect.x = Math.min(strokeRect.x, x);
    strokeRect.y = Math.min(strokeRect.y, y);
    strokeRect.width = right - strokeRect.x;
    strokeRect.height = bottom - strokeRect.y;
  }

  function stamp(x: number, y: number) {
    if (!maskCtx) return;
    const stampSprite = brushSprite();
    const half = stampSprite.width / 2;
    maskCtx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    maskCtx.drawImage(stampSprite, x - half, y - half, stampSprite.width, stampSprite.height);
    maskCtx.globalCompositeOperation = 'source-over';
    growStrokeRect(x - half, y - half, stampSprite.width, stampSprite.height);
    maskChanged();
  }

  /** Stamp along the segment so a fast drag still paints a continuous stroke. */
  function strokeTo(x: number, y: number) {
    if (!lastPoint) {
      stamp(x, y);
      lastPoint = { x, y };
      return;
    }
    const spacing = Math.max(1, brushSize * 0.12);
    const dx = x - lastPoint.x;
    const dy = y - lastPoint.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
    for (let step = 1; step <= steps; step++) {
      stamp(lastPoint.x + (dx * step) / steps, lastPoint.y + (dy * step) / steps);
    }
    lastPoint = { x, y };
  }

  // ---------- history ----------

  function clampRect(rect: Rect): Rect {
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  }

  function pushEntry(entry: HistoryEntry) {
    history.push(entry);
    historyBytes += entry.before.data.length + entry.after.data.length;
    while ((history.length > MAX_HISTORY || historyBytes > MAX_HISTORY_BYTES) && history.length > 1) {
      const dropped = history.shift();
      if (!dropped) break;
      historyBytes -= dropped.before.data.length + dropped.after.data.length;
    }
    redoStack.length = 0;
    updateButtons();
    invalidate();
  }

  function ensureStrokeBase() {
    if (!strokeBase) strokeBase = document.createElement('canvas');
    if (strokeBase.width !== width || strokeBase.height !== height) {
      strokeBase.width = width;
      strokeBase.height = height;
    }
    const ctx = strokeBase.getContext('2d', { willReadFrequently: true })!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(mask as HTMLCanvasElement, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  function beginStroke() {
    ensureStrokeBase();
    strokeRect = null;
    lastPoint = null;
  }

  function endStroke() {
    const rect = strokeRect ? clampRect(strokeRect) : null;
    strokeRect = null;
    lastPoint = null;
    if (!rect || rect.width < 1 || rect.height < 1 || !strokeBase || !maskCtx) return;
    const baseCtx = strokeBase.getContext('2d', { willReadFrequently: true })!;
    pushEntry({
      rect,
      before: baseCtx.getImageData(rect.x, rect.y, rect.width, rect.height),
      after: maskCtx.getImageData(rect.x, rect.y, rect.width, rect.height),
    });
  }

  function undo() {
    const entry = history.pop();
    if (!entry || !maskCtx) return;
    maskCtx.putImageData(entry.before, entry.rect.x, entry.rect.y);
    redoStack.push(entry);
    updateButtons();
    maskChanged();
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry || !maskCtx) return;
    maskCtx.putImageData(entry.after, entry.rect.x, entry.rect.y);
    history.push(entry);
    updateButtons();
    maskChanged();
  }

  /** Restore the entire original photo so manual erasing can begin from zero. */
  function startOver() {
    if (!maskCtx || loading) return;
    const rect = { x: 0, y: 0, width, height };
    const before = maskCtx.getImageData(0, 0, width, height);
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.clearRect(0, 0, width, height);
    maskCtx.fillStyle = '#fff';
    maskCtx.fillRect(0, 0, width, height);
    maskChanged();
    pushEntry({ rect, before, after: maskCtx.getImageData(0, 0, width, height) });
    originalInput.checked = false;
    noteState = { key: 'lite.mask.manual' };
    updateNote();
    setTool('erase');
    setStatus('');
  }

  // ---------- rendering ----------

  /** picture x mask, at working resolution, into `scratch`. */
  function composite() {
    if (!base || !mask) return;
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width;
      scratch.height = height;
    }
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.drawImage(base, 0, 0);
    scratchCtx.globalCompositeOperation = 'destination-in';
    scratchCtx.drawImage(mask, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
  }

  function paintThumb(canvas: HTMLCanvasElement, source: CanvasImageSource) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / Math.max(1, width), canvas.height / Math.max(1, height));
    const w = width * scale;
    const h = height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  function renderThumbs() {
    thumbsDirty = false;
    if (!base || !mask) return;
    paintThumb(beforeThumb, base);
    composite();
    paintThumb(afterThumb, scratch);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const pixelW = Math.max(1, Math.round(stageW * dpr));
    const pixelH = Math.max(1, Math.round(stageH * dpr));
    if (view.width !== pixelW || view.height !== pixelH) {
      view.width = pixelW;
      view.height = pixelH;
    }
    viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    viewCtx.clearRect(0, 0, stageW, stageH);
    if (!base || !mask) return;

    const place = transform();
    const w = width * place.scale;
    const h = height * place.scale;
    viewCtx.imageSmoothingEnabled = true;
    viewCtx.imageSmoothingQuality = 'high';
    if (originalInput.checked) {
      viewCtx.drawImage(base, place.ox, place.oy, w, h);
    } else {
      if (compositeDirty) {
        composite();
        compositeDirty = false;
      }
      viewCtx.drawImage(scratch, place.ox, place.oy, w, h);
    }
    viewCtx.strokeStyle = 'rgba(120, 90, 70, .35)';
    viewCtx.lineWidth = 1;
    viewCtx.strokeRect(place.ox + 0.5, place.oy + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));

    if (pointerInside && !panning && !loading) {
      const radius = Math.max(1, (brushSize * place.scale) / 2);
      viewCtx.beginPath();
      viewCtx.arc(pointerX, pointerY, radius, 0, Math.PI * 2);
      viewCtx.strokeStyle = 'rgba(255,255,255,.85)';
      viewCtx.lineWidth = 2;
      viewCtx.stroke();
      viewCtx.strokeStyle = 'rgba(60,40,25,.7)';
      viewCtx.lineWidth = 1;
      viewCtx.stroke();
    }
    if (thumbsDirty) renderThumbs();
  }

  function invalidate() {
    if (frameHandle) return;
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = 0;
      draw();
    });
  }

  /** The mask itself changed: both the stage and the preview have to catch up. */
  function maskChanged() {
    compositeDirty = true;
    thumbsDirty = true;
    invalidate();
  }

  // ---------- tools ----------

  function setTool(next: Tool) {
    tool = next;
    eraseButton.classList.toggle('active', next === 'erase');
    restoreButton.classList.toggle('active', next === 'restore');
  }

  function setBrushSize(value: number) {
    brushSize = Math.min(Number(sizeInput.max), Math.max(Number(sizeInput.min), value));
    sizeInput.value = String(brushSize);
    updateReadouts();
    invalidate();
  }

  function setZoom(value: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    // Zoom around the middle of the stage when there is no cursor to anchor to.
    const anchor = pointerInside ? { x: pointerX, y: pointerY } : {
      x: stage.clientWidth / 2,
      y: stage.clientHeight / 2,
    };
    const place = transform();
    const imageX = (anchor.x - place.ox) / place.scale;
    const imageY = (anchor.y - place.oy) / place.scale;
    zoom = next;
    const scale = fitScale() * zoom;
    panX = anchor.x - imageX * scale - (stage.clientWidth - width * scale) / 2;
    panY = anchor.y - imageY * scale - (stage.clientHeight - height * scale) / 2;
    invalidate();
  }

  function fitToStage() {
    zoom = 1;
    panX = 0;
    panY = 0;
    invalidate();
  }

  // ---------- loading ----------

  function prepare(original: HTMLImageElement, maskImage: HTMLImageElement, w: number, h: number) {
    width = w;
    height = h;
    base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const baseCtx = base.getContext('2d')!;
    baseCtx.imageSmoothingEnabled = true;
    baseCtx.imageSmoothingQuality = 'high';
    baseCtx.drawImage(original, 0, 0, w, h);

    mask = document.createElement('canvas');
    mask.width = w;
    mask.height = h;
    maskCtx = mask.getContext('2d', { willReadFrequently: true })!;
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = 'high';
    maskCtx.drawImage(maskImage, 0, 0, w, h);

    strokeBase = null;
    history.length = 0;
    redoStack.length = 0;
    historyBytes = 0;
    fitToStage();
    invalidate();
    updateButtons();
  }

  /** Re-run the Rust pass: `reset` also reloads the picture (a new import). */
  async function refresh(reset: boolean) {
    if (loading) return;
    loading = true;
    rerunButton.disabled = true;
    startOverButton.disabled = true;
    applyButton.disabled = true;
    setStatus(liteT(reset ? 'lite.mask.loading' : 'lite.mask.rerunning'));
    try {
      const result = await window.api.maskPreview(Number(strengthInput.value), Number(featherInput.value));
      const originalUrl = result.original;
      const maskUrl = result.mask;
      const workWidth = result.width;
      const workHeight = result.height;
      if (!result.ok || !originalUrl || !maskUrl || !workWidth || !workHeight) {
        // The backend writes a finished, localized sentence for its own failures.
        setStatus(result.error || liteT('lite.mask.loadFailed', { error: '' }), !result.error);
        return;
      }
      let images: [HTMLImageElement, HTMLImageElement];
      try {
        images = await Promise.all([liteLoadImage(originalUrl), liteLoadImage(maskUrl)]);
      } catch (error) {
        setStatus(liteT('lite.mask.loadFailed', { error: String(error) }), true);
        return;
      }
      noteState = result.rejected
        ? { key: 'lite.mask.rejected' }
        : result.applied
          ? { key: 'lite.mask.subject', params: { n: Math.round((result.subject ?? 0) * 100) } }
          : { key: 'lite.mask.transparent' };
      const sameSize = workWidth === width && workHeight === height;
      if (!reset && sameSize && maskCtx) {
        // Keep the brush work undoable: the fresh mask replaces the old one as one
        // history entry rather than wiping the stack.
        const rect = { x: 0, y: 0, width, height };
        const before = maskCtx.getImageData(0, 0, width, height);
        maskCtx.globalCompositeOperation = 'copy';
        maskCtx.drawImage(images[1], 0, 0, width, height);
        maskCtx.globalCompositeOperation = 'source-over';
        maskChanged();
        pushEntry({ rect, before, after: maskCtx.getImageData(0, 0, width, height) });
      } else {
        prepare(images[0], images[1], workWidth, workHeight);
      }
      setTool(tool);
      updateNote();
      setStatus('');
    } catch (error) {
      setStatus(liteT('lite.mask.loadFailed', { error: String(error) }), true);
    } finally {
      loading = false;
      rerunButton.disabled = false;
      updateButtons();
    }
  }

  async function apply() {
    if (!base || !mask || loading) return;
    loading = true;
    updateButtons();
    setStatus(liteT('lite.mask.saving'));
    try {
      composite();
      const saved = await window.api.commitCustomImage(false, scratch.toDataURL('image/png'));
      if (!saved.ok) throw new Error(saved.error || liteT('lite.image.saveFailed'));
      setStatus(liteT('lite.mask.applied'));
      window.api.closeMaskEditor();
    } catch (error) {
      setStatus(liteT('lite.mask.applyFailed', { error: String(error) }), true);
      loading = false;
      updateButtons();
    }
  }

  // ---------- events ----------

  eraseButton.addEventListener('click', () => setTool('erase'));
  restoreButton.addEventListener('click', () => setTool('restore'));
  sizeInput.addEventListener('input', () => setBrushSize(Number(sizeInput.value)));
  hardnessInput.addEventListener('input', () => {
    brushHardness = Number(hardnessInput.value) / 100;
    updateReadouts();
  });
  strengthInput.addEventListener('input', updateReadouts);
  featherInput.addEventListener('input', updateReadouts);
  originalInput.addEventListener('change', invalidate);
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  rerunButton.addEventListener('click', () => void refresh(false));
  startOverButton.addEventListener('click', startOver);
  el<HTMLButtonElement>('fit').addEventListener('click', fitToStage);
  el<HTMLButtonElement>('zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
  el<HTMLButtonElement>('zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
  el<HTMLButtonElement>('cancel').addEventListener('click', () => window.api.closeMaskEditor());
  el<HTMLButtonElement>('close').addEventListener('click', () => window.api.closeMaskEditor());
  applyButton.addEventListener('click', () => void apply());

  view.addEventListener('contextmenu', (event) => event.preventDefault());
  view.addEventListener('pointerdown', (event) => {
    if (!mask || loading) return;
    const point = imagePoint(event.clientX, event.clientY);
    const screen = viewPoint(event.clientX, event.clientY);
    pointerX = screen.x;
    pointerY = screen.y;
    pointerInside = true;
    if (event.button === 1 || event.button === 2 || spaceHeld) {
      panning = true;
      panOrigin = { x: event.clientX, y: event.clientY, panX, panY };
      view.setPointerCapture(event.pointerId);
      view.style.cursor = 'grabbing';
      invalidate();
      return;
    }
    if (event.button !== 0) return;
    painting = true;
    view.setPointerCapture(event.pointerId);
    beginStroke();
    strokeTo(point.x, point.y);
    invalidate();
  });
  view.addEventListener('pointermove', (event) => {
    const screen = viewPoint(event.clientX, event.clientY);
    pointerX = screen.x;
    pointerY = screen.y;
    pointerInside = true;
    if (panning) {
      panX = panOrigin.panX + (event.clientX - panOrigin.x);
      panY = panOrigin.panY + (event.clientY - panOrigin.y);
      invalidate();
      return;
    }
    if (painting) {
      const point = imagePoint(event.clientX, event.clientY);
      strokeTo(point.x, point.y);
    }
    invalidate();
  });
  const finishStroke = (event: PointerEvent) => {
    if (painting) {
      painting = false;
      endStroke();
    }
    if (panning) {
      panning = false;
      view.style.cursor = spaceHeld ? 'grab' : 'crosshair';
    }
    if (view.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId);
    invalidate();
  };
  view.addEventListener('pointerup', finishStroke);
  view.addEventListener('pointercancel', finishStroke);
  view.addEventListener('pointerleave', () => {
    pointerInside = false;
    invalidate();
  });
  view.addEventListener('wheel', (event) => {
    if (!mask) return;
    event.preventDefault();
    const anchor = viewPoint(event.clientX, event.clientY);
    const place = transform();
    const imageX = (anchor.x - place.ox) / place.scale;
    const imageY = (anchor.y - place.oy) / place.scale;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.exp(-event.deltaY * 0.0015)));
    const scale = fitScale() * zoom;
    panX = anchor.x - imageX * scale - (stage.clientWidth - width * scale) / 2;
    panY = anchor.y - imageY * scale - (stage.clientHeight - height * scale) / 2;
    invalidate();
  }, { passive: false });

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === ' ') {
      spaceHeld = true;
      view.style.cursor = 'grab';
      event.preventDefault();
      return;
    }
    if (event.key === '[') setBrushSize(brushSize - 8);
    if (event.key === ']') setBrushSize(brushSize + 8);
    if (key === 'e') setTool('erase');
    if (key === 'r') setTool('restore');
    if (key === '0' || key === 'f') fitToStage();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key !== ' ') return;
    spaceHeld = false;
    if (!panning) view.style.cursor = 'crosshair';
  });
  window.addEventListener('blur', () => {
    spaceHeld = false;
    if (!panning) view.style.cursor = 'crosshair';
  });
  new ResizeObserver(() => invalidate()).observe(stage);

  void (async () => {
    // Translate before the first paint so no key is ever painted on screen.
    await liteLoadDictionary().catch((error) => console.error('[lite-mask] i18n:', error));
    // The dictionary already carries the locale `system` resolved to, so only the
    // raw config value can tell whether the preference itself changed.
    let localePreference: LocalePreference = await window.api
      .getConfig()
      .then((cfg) => cfg.locale)
      .catch((): LocalePreference => 'system');
    updateReadouts();
    setTool('erase');
    updateButtons();
    updateNote();
    window.api.onMaskReload(() => void refresh(true));
    window.api.onConfigChanged((cfg) => {
      if (cfg.locale === localePreference) return;
      localePreference = cfg.locale;
      void liteLoadDictionary().then(updateNote).catch((error) => console.error('[lite-mask] i18n:', error));
    });
    await refresh(true);
  })();
})();
