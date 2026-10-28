'use strict';

const canvas = document.querySelector('#main-canvas');
const ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null;
const captureImage = document.getElementById('capture-image');
const captureCanvas = document.getElementById('capture-canvas');
const captureWorkspace = document.getElementById('capture-workspace');
const captureCtx = captureCanvas ? captureCanvas.getContext('2d', { willReadFrequently: true }) : null;
const paintCursor = document.getElementById('paint-cursor');

let drawing = false;
let paintOpen = false;
let tool = 'pen';
let isFilled = false;
let pageZoom = 1;
let pageViewSnapshot = null;
let boardMode = 'transparent';
let boardCustomColor = '#ffffff';
let pageInteraction = false;
let laserPointerActive = false;
let timerToolId = 0;
let activePointerId = null;

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 25;

let persistentCanvasState = null;
let persistentStateImage = null;
let persistentStateSrc = null;
let persistentStateLoading = null;

let isSelecting = false;
let startX = 0;
let startY = 0;
let selectionStartClientX = 0;
let selectionStartClientY = 0;
let shapeStartX = 0;
let shapeStartY = 0;
let isShapeDrawing = false;
let shapeSnapshot = null;
let shapeFrameId = 0;
let pendingShapePoint = null;

let captureDrawing = false;
let captureShapeDrawing = false;
let captureShapeStartX = 0;
let captureShapeStartY = 0;
let captureShapeSnapshot = null;
let captureSourceRect = null;
let captureZoom = 1;
let captureReturnState = null;
const capturePointers = new Map();
let capturePinchDistance = 0;

let cachedRect = null;
let cachedRectTime = 0;
let persistTimer = 0;
let cursorFrameId = 0;
let pendingCursorEvent = null;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (error) {}
}

function removeStorage(key) {
  try { localStorage.removeItem(key); } catch (error) {}
}

function getPaintIpc() {
  try {
    if (window.electronAPI && typeof window.electronAPI.send === 'function') return window.electronAPI;
    if (typeof require === 'function') {
      const electron = require('electron');
      if (electron && electron.ipcRenderer) return electron.ipcRenderer;
    }
  } catch (error) {}
  return null;
}

function invalidateRect() {
  cachedRect = null;
  cachedRectTime = 0;
}

function getCanvasRect() {
  const now = performance.now();
  if (cachedRect && now - cachedRectTime < 32) return cachedRect;
  cachedRect = canvas.getBoundingClientRect();
  cachedRectTime = now;
  return cachedRect;
}

function getCanvasPoint(clientX, clientY) {
  const rect = getCanvasRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
  const cssX = Math.max(0, Math.min(cssWidth, clientX - rect.left));
  const cssY = Math.max(0, Math.min(cssHeight, clientY - rect.top));
  return { x: cssX * scaleX, y: cssY * scaleY, cssX, cssY };
}

function getCaptureCoordinates(clientX, clientY) {
  const rect = captureCanvas.getBoundingClientRect();
  const scaleX = captureCanvas.width / Math.max(1, rect.width);
  const scaleY = captureCanvas.height / Math.max(1, rect.height);
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function createSnapshot() {
  try {
    if (typeof OffscreenCanvas === 'function' && canvas && canvas.width > 0 && canvas.height > 0) {
      const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
      offscreen.getContext('2d').drawImage(canvas, 0, 0);
      return offscreen.transferToImageBitmap();
    }
  } catch (error) {}
  try { return canvas.toDataURL('image/png'); } catch (error) { return null; }
}

function disposeSnapshot(snapshot) {
  try {
    if (snapshot && typeof snapshot.close === 'function') snapshot.close();
  } catch (error) {}
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return Promise.resolve(false);
  if (typeof ImageBitmap !== 'undefined' && snapshot instanceof ImageBitmap) {
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(snapshot, 0, 0);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.resolve(false);
    }
  }
  if (typeof snapshot === 'string') {
    return new Promise((resolve) => {
      const image = new Image();
      const finish = (ok) => {
        if (ok) {
          try {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0);
            resolve(true);
          } catch (error) {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = snapshot;
    });
  }
  return Promise.resolve(false);
}

function doPersistDrawing() {
  if (readStorage('set_drawing-recovery', 'true') === 'false') return;
  if (readStorage('set_auto-save', 'true') === 'false') return;
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
  let dataUrl = null;
  try { dataUrl = canvas.toDataURL('image/png'); } catch (error) { return; }
  if (!dataUrl) return;
  const ipc = getPaintIpc();
  if (ipc && typeof ipc.send === 'function') {
    try { ipc.send('save-drawing-png', dataUrl); } catch (error) {}
  } else {
    try { localStorage.setItem('anka-drawing-local', dataUrl); } catch (error) {}
  }
}

function persistDrawing() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    doPersistDrawing();
  }, 300);
}

function flushPersistence() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = 0;
  }
  doPersistDrawing();
}

function setPersistentState(src) {
  persistentCanvasState = src || null;
  if (src === persistentStateSrc && (persistentStateImage || !src)) return persistentStateLoading || Promise.resolve(persistentStateImage);
  persistentStateSrc = src;
  persistentStateImage = null;
  if (!src) {
    persistentStateLoading = null;
    return Promise.resolve(null);
  }
  const currentSrc = src;
  persistentStateLoading = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (persistentStateSrc === currentSrc) {
        persistentStateImage = image;
        resolve(image);
      } else {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = currentSrc;
  });
  return persistentStateLoading;
}

function drawPersistentState() {
  if (!persistentCanvasState) return Promise.resolve(false);
  const targetSrc = persistentCanvasState;
  const drawImage = (image) => {
    if (!image || persistentStateSrc !== targetSrc) return false;
    try {
      if (canvas.width > 0 && canvas.height > 0) {
        ctx.drawImage(image, 0, 0);
        return true;
      }
    } catch (error) {}
    return false;
  };
  if (persistentStateImage) return Promise.resolve(drawImage(persistentStateImage));
  const pending = persistentStateLoading || setPersistentState(targetSrc);
  return pending.then((image) => drawImage(image));
}

function saveDrawingNow() {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
  try {
    const dataUrl = canvas.toDataURL('image/png');
    setPersistentState(dataUrl);
    const ipc = getPaintIpc();
    if (ipc && typeof ipc.send === 'function') {
      ipc.send('save-drawing-png', dataUrl);
    } else {
      try { localStorage.setItem('anka-drawing-local', dataUrl); } catch (error) {}
    }
    if (typeof showToast === 'function') showToast('Çizim kaydedildi.');
    return true;
  } catch (error) {
    return false;
  }
}

async function restoreDrawing() {
  if (readStorage('set_drawing-recovery', 'true') === 'false') return;
  const ipc = getPaintIpc();
  let saved = null;
  if (ipc && typeof ipc.invoke === 'function') {
    try { saved = await ipc.invoke('load-drawing-png'); } catch (error) {}
  }
  if (!saved) {
    try { saved = localStorage.getItem('anka-drawing-local'); } catch (error) {}
  }
  if (saved) {
    setPersistentState(saved);
    if (paintOpen) initCanvas(true);
  }
}

function initCanvas(force = false) {
  const container = document.getElementById('draw-layer');
  if (!container || !canvas || !ctx) return;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const sizeChanged = canvas.width !== width || canvas.height !== height;
  if (!sizeChanged && !force) return;

  let existing = null;
  if (sizeChanged && canvas.width > 0 && canvas.height > 0) {
    try {
      if (typeof OffscreenCanvas === 'function') {
        const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
        offscreen.getContext('2d').drawImage(canvas, 0, 0);
        existing = offscreen;
      } else {
        const temp = document.createElement('canvas');
        temp.width = canvas.width;
        temp.height = canvas.height;
        temp.getContext('2d').drawImage(canvas, 0, 0);
        existing = temp;
      }
    } catch (error) {}
  }

  if (sizeChanged) {
    canvas.width = width;
    canvas.height = height;
    invalidateRect();
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (existing) {
    try { ctx.drawImage(existing, 0, 0); return; } catch (error) {}
  }

  drawPersistentState().then((drawn) => {
    if (drawn) return;
    if (undoStack.length > 0) restoreSnapshot(undoStack[undoStack.length - 1]);
  });
}

function saveState() {
  if (!canvas) return;
  if (undoStack.length >= MAX_UNDO) disposeSnapshot(undoStack.shift());
  const snapshot = createSnapshot();
  if (snapshot) undoStack.push(snapshot);
  for (const item of redoStack) disposeSnapshot(item);
  redoStack.length = 0;
}

async function undo() {
  if (!canvas || undoStack.length === 0) return;
  const current = createSnapshot();
  const last = undoStack.pop();
  if (current) redoStack.push(current);
  await restoreSnapshot(last);
  disposeSnapshot(last);
  try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
  persistDrawing();
}

async function redo() {
  if (!canvas || redoStack.length === 0) return;
  const current = createSnapshot();
  const next = redoStack.pop();
  if (current) undoStack.push(current);
  await restoreSnapshot(next);
  disposeSnapshot(next);
  try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
  persistDrawing();
}

function clearCanvas() {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const item of undoStack) disposeSnapshot(item);
  for (const item of redoStack) disposeSnapshot(item);
  undoStack.length = 0;
  redoStack.length = 0;
  persistentCanvasState = null;
  persistentStateSrc = null;
  persistentStateImage = null;
  persistentStateLoading = null;
  const ipc = getPaintIpc();
  if (ipc && typeof ipc.send === 'function') {
    try { ipc.send('clear-drawing-png'); } catch (error) {}
  }
  removeStorage('anka-drawing-local');
}

function applyStyles() {
  const colorEl = document.getElementById('p-color');
  const widthEl = document.getElementById('p-width');
  const opacityEl = document.getElementById('p-opacity');
  const color = colorEl ? colorEl.value : '#ff4757';
  const width = widthEl ? (parseInt(widthEl.value, 10) || 4) : 4;
  const opacity = opacityEl ? (parseInt(opacityEl.value, 10) || 100) / 100 : 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = opacity;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  if (tool === 'neon') {
    ctx.shadowBlur = 15;
    ctx.shadowColor = color;
  } else if (tool === 'highlighter') {
    ctx.globalAlpha = opacity * 0.35;
    ctx.lineWidth = Math.max(width, 18);
  }
}

function applyCaptureStyles() {
  const colorEl = document.getElementById('p-color');
  const widthEl = document.getElementById('p-width');
  const opacityEl = document.getElementById('p-opacity');
  const color = colorEl ? colorEl.value : '#ff4757';
  const width = widthEl ? (parseInt(widthEl.value, 10) || 4) : 4;
  const opacity = opacityEl ? (parseInt(opacityEl.value, 10) || 100) / 100 : 1;
  captureCtx.strokeStyle = color;
  captureCtx.fillStyle = color;
  captureCtx.lineWidth = tool === 'highlighter' ? Math.max(width, 18) : width;
  captureCtx.globalAlpha = tool === 'highlighter' ? opacity * 0.35 : opacity;
  captureCtx.lineCap = 'round';
  captureCtx.lineJoin = 'round';
  captureCtx.shadowBlur = tool === 'neon' ? 15 : 0;
  captureCtx.shadowColor = color;
}

function drawArrow(targetCtx, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  const lineWidth = Math.max(1, Number(targetCtx.lineWidth) || 1);
  if (distance < 0.5) return;
  const unitX = dx / distance;
  const unitY = dy / distance;
  const normalX = -unitY;
  const normalY = unitX;
  const headLength = Math.min(distance * 0.42, Math.max(lineWidth * 4, 12));
  const headWidth = Math.min(distance * 0.28, Math.max(lineWidth * 2.8, headLength * 0.55));
  const baseX = x2 - unitX * headLength;
  const baseY = y2 - unitY * headLength;
  const leftX = baseX + normalX * headWidth;
  const leftY = baseY + normalY * headWidth;
  const rightX = baseX - normalX * headWidth;
  const rightY = baseY - normalY * headWidth;
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'source-over';
  targetCtx.beginPath();
  targetCtx.moveTo(x1, y1);
  targetCtx.lineTo(baseX, baseY);
  targetCtx.stroke();
  targetCtx.beginPath();
  targetCtx.moveTo(x2, y2);
  targetCtx.lineTo(leftX, leftY);
  targetCtx.lineTo(rightX, rightY);
  targetCtx.closePath();
  targetCtx.fillStyle = targetCtx.strokeStyle;
  targetCtx.fill();
  targetCtx.restore();
}

function drawShape(x1, y1, x2, y2, currentTool) {
  if (!ctx) return;
  ctx.beginPath();
  applyStyles();
  if (currentTool === 'line') {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (currentTool === 'rect') {
    const w = x2 - x1;
    const h = y2 - y1;
    if (isFilled) ctx.fillRect(x1, y1, w, h);
    ctx.strokeRect(x1, y1, w, h);
  } else if (currentTool === 'circle') {
    const radiusX = Math.abs(x2 - x1) / 2;
    const radiusY = Math.abs(y2 - y1) / 2;
    const centerX = x1 + (x2 - x1) / 2;
    const centerY = y1 + (y2 - y1) / 2;
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    if (isFilled) ctx.fill();
    ctx.stroke();
  } else if (currentTool === 'arrow') {
    drawArrow(ctx, x1, y1, x2, y2);
  }
}

function captureDrawShape(x1, y1, x2, y2) {
  if (!captureCtx) return;
  captureCtx.beginPath();
  applyCaptureStyles();
  captureCtx.globalCompositeOperation = 'source-over';
  if (tool === 'line') {
    captureCtx.moveTo(x1, y1);
    captureCtx.lineTo(x2, y2);
    captureCtx.stroke();
  } else if (tool === 'rect') {
    if (isFilled) captureCtx.fillRect(x1, y1, x2 - x1, y2 - y1);
    captureCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  } else if (tool === 'circle') {
    captureCtx.ellipse(x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    if (isFilled) captureCtx.fill();
    captureCtx.stroke();
  } else if (tool === 'arrow') {
    drawArrow(captureCtx, x1, y1, x2, y2);
  }
}

function startDrawing(e, clientX, clientY) {
  if (!paintOpen || !canvas || !ctx) return;
  const point = getCanvasPoint(clientX, clientY);

  if (tool === 'select') {
    isSelecting = true;
    startX = point.cssX;
    startY = point.cssY;
    selectionStartClientX = clientX;
    selectionStartClientY = clientY;
    const selectionBox = document.getElementById('selection-box');
    const selectionOverlay = document.getElementById('selection-overlay');
    if (selectionOverlay) selectionOverlay.style.display = 'block';
    if (selectionBox) {
      selectionBox.style.left = startX + 'px';
      selectionBox.style.top = startY + 'px';
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      selectionBox.style.display = 'block';
    }
    return;
  }

  if (tool === 'text') {
    openTextInput(point.x, point.y);
    return;
  }

  if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arrow') {
    isShapeDrawing = true;
    shapeStartX = point.x;
    shapeStartY = point.y;
    pendingShapePoint = point;
    saveState();
    try { shapeSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (error) { shapeSnapshot = null; }
    return;
  }

  drawing = true;
  saveState();
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  applyStyles();
}

function draw(e, clientX, clientY) {
  if (!paintOpen || !canvas || !ctx) return;
  const point = getCanvasPoint(clientX, clientY);

  if (tool === 'select' && isSelecting) {
    const selectionBox = document.getElementById('selection-box');
    if (selectionBox) {
      const boxLeft = Math.min(startX, point.cssX);
      const boxTop = Math.min(startY, point.cssY);
      const boxWidth = Math.abs(clientX - selectionStartClientX);
      const boxHeight = Math.abs(clientY - selectionStartClientY);
      selectionBox.style.left = boxLeft + 'px';
      selectionBox.style.top = boxTop + 'px';
      selectionBox.style.width = boxWidth + 'px';
      selectionBox.style.height = boxHeight + 'px';
    }
    return;
  }

  if (isShapeDrawing && shapeSnapshot) {
    pendingShapePoint = point;
    scheduleShapePreview();
    return;
  }

  if (!drawing) return;
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function stopDrawing(e) {
  if (tool === 'select' && isSelecting) {
    isSelecting = false;
    const selectionBox = document.getElementById('selection-box');
    const selectionOverlay = document.getElementById('selection-overlay');
    if (selectionBox) selectionBox.style.display = 'none';
    if (selectionOverlay) selectionOverlay.style.display = 'none';

    const rect = getCanvasRect();
    const endClientX = e ? (e.clientX || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : selectionStartClientX)) : selectionStartClientX;
    const endClientY = e ? (e.clientY || (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : selectionStartClientY)) : selectionStartClientY;
    const sX = Math.min(startX, endClientX - rect.left);
    const sY = Math.min(startY, endClientY - rect.top);
    const sWidth = Math.abs((endClientX - rect.left) - startX);
    const sHeight = Math.abs((endClientY - rect.top) - startY);
    if (sWidth > 10 && sHeight > 10) captureSelectedPage(sX, sY, sWidth, sHeight);
    return;
  }

  if (isShapeDrawing) {
    if (pendingShapePoint) renderShapePreview(pendingShapePoint);
    if (shapeFrameId) cancelAnimationFrame(shapeFrameId);
    shapeFrameId = 0;
    pendingShapePoint = null;
    isShapeDrawing = false;
    shapeSnapshot = null;
    try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
    persistDrawing();
    return;
  }

  if (drawing) {
    try { ctx.closePath(); } catch (error) {}
    drawing = false;
    try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
    persistDrawing();
  }
}

function scheduleShapePreview() {
  if (shapeFrameId) return;
  shapeFrameId = requestAnimationFrame(() => {
    shapeFrameId = 0;
    if (isShapeDrawing && shapeSnapshot && pendingShapePoint) renderShapePreview(pendingShapePoint);
  });
}

function renderShapePreview(point) {
  if (!shapeSnapshot || !ctx) return;
  try { ctx.putImageData(shapeSnapshot, 0, 0); } catch (error) { return; }
  applyStyles();
  drawShape(shapeStartX, shapeStartY, point.x, point.y, tool);
}

function openTextInput(x, y) {
  if (!canvas || !ctx) return;
  const existing = document.getElementById('canvas-text-input');
  if (existing) existing.remove();

  const widthEl = document.getElementById('p-width');
  const colorEl = document.getElementById('p-color');
  const fontPx = ((widthEl ? parseInt(widthEl.value, 10) : 4) || 4) * 4 + 10;
  const fontColor = colorEl ? colorEl.value : '#ff4757';

  const rect = getCanvasRect();
  const scaleX = rect.width / Math.max(1, canvas.width);
  const scaleY = rect.height / Math.max(1, canvas.height);
  const cssX = rect.left + x * scaleX;
  const cssY = rect.top + y * scaleY;
  const cssFontPx = Math.max(10, fontPx * scaleY);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'canvas-text-input';
  input.style.cssText = `position:fixed;left:${cssX}px;top:${cssY}px;font:${cssFontPx}px Arial;color:${fontColor};background:transparent;border:1px dashed #ff4757;outline:none;z-index:10000;padding:2px 4px;min-width:80px;`;
  document.body.appendChild(input);
  input.focus();

  const commit = () => {
    if (!input.isConnected) return;
    const value = input.value;
    input.remove();
    if (!value) return;
    saveState();
    ctx.save();
    ctx.font = `${fontPx}px Arial`;
    ctx.fillStyle = fontColor;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillText(value, x, y + fontPx);
    ctx.restore();
    try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
    persistDrawing();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      input.remove();
    }
  });
  input.addEventListener('blur', commit);
}

function updatePaintCursor(event) {
  if (!paintCursor || !paintOpen || pageInteraction) return;
  if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'neon' && tool !== 'eraser') {
    paintCursor.classList.remove('visible');
    return;
  }
  pendingCursorEvent = event;
  if (cursorFrameId) return;
  cursorFrameId = requestAnimationFrame(() => {
    cursorFrameId = 0;
    const source = pendingCursorEvent;
    pendingCursorEvent = null;
    if (!source) return;
    const widthEl = document.getElementById('p-width');
    const width = Math.max(2, (parseInt(widthEl ? widthEl.value : '4', 10) || 4));
    const size = tool === 'highlighter' ? Math.max(width, 18) : width;
    const colorEl = document.getElementById('p-color');
    paintCursor.style.left = `${source.clientX}px`;
    paintCursor.style.top = `${source.clientY}px`;
    paintCursor.style.width = `${size}px`;
    paintCursor.style.height = `${size}px`;
    paintCursor.style.borderColor = tool === 'eraser' ? '#f4f4f5' : (colorEl ? colorEl.value : '#ff4757');
    paintCursor.classList.add('visible');
  });
}

function hidePaintCursor() {
  if (paintCursor) paintCursor.classList.remove('visible');
}

function applyTouchModePreference() {
  let stored = readStorage('set_touch-mode', null);
  if (stored === null) {
    stored = 'true';
    writeStorage('set_touch-mode', stored);
  }
  const enabled = stored === 'true';
  document.body.classList.toggle('touch-mode', enabled);
  document.documentElement.classList.toggle('touch-mode', enabled);
}

function resetPaintLayerForStartup() {
  const layer = document.getElementById('draw-layer');
  if (!layer) return;
  paintOpen = false;
  pageInteraction = false;
  layer.classList.remove('active', 'page-interaction');
  layer.style.pointerEvents = 'none';
  layer.style.touchAction = 'auto';
  if (canvas) {
    canvas.style.pointerEvents = 'none';
    canvas.style.touchAction = 'auto';
  }
}

function initializePaintSurface() {
  applyTouchModePreference();
  resetPaintLayerForStartup();
  initCanvas(true);
  const layer = document.getElementById('draw-layer');
  if (layer && typeof ResizeObserver === 'function') {
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (layer.clientWidth > 0 && layer.clientHeight > 0) initCanvas();
      });
    });
    observer.observe(layer);
  }
}

function setTool(t) {
  tool = t;
  const buttons = document.querySelectorAll('.paint-menu .t-btn, .paint-menu-container .t-btn');
  buttons.forEach((button) => {
    if (!button.classList.contains('bg-btn') && !button.classList.contains('bg-color-btn')) button.classList.remove('active');
  });
  const target = document.getElementById('t-' + t);
  if (target) target.classList.add('active');
  if (paintCursor) paintCursor.style.display = (t === 'pen' || t === 'highlighter' || t === 'neon' || t === 'eraser') ? '' : 'none';
  hidePaintCursor();
}

function toggleFill() {
  isFilled = !isFilled;
  const fillButton = document.getElementById('t-fill');
  if (fillButton) fillButton.classList.toggle('active', isFilled);
}

function setActiveClass(element, selector) {
  if (!element) return;
  document.querySelectorAll(selector).forEach((item) => item.classList.remove('active'));
  element.classList.add('active');
}

function setToolActive(element) {
  setActiveClass(element, '.paint-menu-container [id^="t-"]');
}

function selectPaintCategory(category) {
  const tabs = document.querySelectorAll('#paint-menu [data-paint-tab]');
  const panels = document.querySelectorAll('#paint-menu [data-paint-category]');
  if (!Array.from(tabs).some((tab) => tab.dataset.paintTab === category)) return;
  tabs.forEach((tab) => {
    const selected = tab.dataset.paintTab === category;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.paintCategory !== category;
  });
}

function togglePaintMenu() {
  paintOpen = !paintOpen;
  const menu = document.getElementById('paint-menu');
  const layer = document.getElementById('draw-layer');
  const button = document.getElementById('btn-paint');
  if (!menu || !layer) return;

  if (paintOpen) {
    document.body.classList.remove('dragging-ui', 'capture-active');
    menu.style.display = 'flex';
    layer.classList.add('active');
    layer.style.pointerEvents = 'auto';
    if (canvas) canvas.style.pointerEvents = 'auto';
    layer.classList.remove('page-interaction');
    pageInteraction = false;
    if (button) button.classList.add('active');
    if (canvas && (canvas.width <= 1 || canvas.height <= 1)) initCanvas(true);
    invalidateRect();
  } else {
    menu.style.display = 'none';
    hidePaintCursor();
    menu.classList.remove('paint-touch-mode');
    layer.classList.remove('active', 'page-interaction');
    layer.style.pointerEvents = 'none';
    if (canvas) canvas.style.pointerEvents = 'none';
    pageInteraction = false;
    document.documentElement.classList.remove('touch-page-mode');
    document.body.classList.remove('touch-page-mode');
    writeStorage('set_touch-page-mode', 'false');
    const touchButton = document.getElementById('touch-page-mode-btn');
    if (touchButton) touchButton.classList.remove('active');
    if (button) button.classList.remove('active');
    drawing = false;
    isSelecting = false;
    isShapeDrawing = false;
    shapeSnapshot = null;
    activePointerId = null;
    document.body.classList.remove('dragging-ui', 'capture-active');
    closeCaptureWorkspace();
    removeStorage('anka_math_tools');
    ['ruler', 'protractor'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    });
  }
}

function toggleTouchPageMode() {
  const menu = document.getElementById('paint-menu');
  const layer = document.getElementById('draw-layer');
  const button = document.getElementById('touch-page-mode-btn');
  if (!menu || !layer) return;
  const enabled = !menu.classList.contains('paint-touch-mode');
  menu.classList.toggle('paint-touch-mode', enabled);
  layer.classList.toggle('page-interaction', enabled);
  layer.style.pointerEvents = enabled ? 'none' : 'auto';
  if (canvas) canvas.style.pointerEvents = enabled ? 'none' : 'auto';
  pageInteraction = enabled;
  if (enabled) hidePaintCursor();
  drawing = false;
  isSelecting = false;
  isShapeDrawing = false;
  shapeSnapshot = null;
  activePointerId = null;
  document.documentElement.classList.toggle('touch-page-mode', enabled);
  document.body.classList.toggle('touch-page-mode', enabled);
  writeStorage('set_touch-page-mode', String(enabled));
  if (button) {
    button.classList.toggle('active', enabled);
    button.title = enabled ? 'Çizim moduna dön' : 'Dokunmatik Sayfa Modu';
  }
}

function toggleScreenGrid() {
  const grid = document.getElementById('screen-grid-layer');
  if (grid) grid.classList.toggle('active');
}

function toggleLaserPointer() {
  laserPointerActive = !laserPointerActive;
  const laser = document.getElementById('laser-pointer');
  if (laser) laser.classList.toggle('active', laserPointerActive);
  if (!laserPointerActive && laser) laser.style.display = '';
  if (laserPointerActive && laser) {
    if (!window._ankaLaserMove) {
      window._ankaLaserMove = (event) => {
        if (!laserPointerActive) return;
        const mainView = document.getElementById('main-view');
        if (!mainView) return;
        const rect = mainView.getBoundingClientRect();
        laser.style.left = `${event.clientX - rect.left}px`;
        laser.style.top = `${event.clientY - rect.top}px`;
      };
      window.addEventListener('pointermove', window._ankaLaserMove, { passive: true });
    }
  }
}

function toggleTimerTool() {
  let timer = document.getElementById('lesson-timer');
  const mainView = document.getElementById('main-view');
  if (timer) {
    timer.remove();
    if (timerToolId) clearInterval(timerToolId);
    timerToolId = 0;
    return;
  }
  if (!mainView) return;
  timer = document.createElement('div');
  timer.id = 'lesson-timer';
  timer.innerHTML = '<strong>00:00</strong><button type="button">Başlat</button><button type="button">Sıfırla</button>';
  mainView.appendChild(timer);
  let elapsed = 0;
  const output = timer.querySelector('strong');
  const startButton = timer.querySelector('button');
  const resetButton = timer.querySelectorAll('button')[1];
  if (startButton) {
    startButton.onclick = () => {
      if (timerToolId) {
        clearInterval(timerToolId);
        timerToolId = 0;
        startButton.textContent = 'Başlat';
        return;
      }
      startButton.textContent = 'Durdur';
      timerToolId = setInterval(() => {
        elapsed += 1;
        if (output) output.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
      }, 1000);
    };
  }
  if (resetButton) {
    resetButton.onclick = () => {
      elapsed = 0;
      if (output) output.textContent = '00:00';
    };
  }
}

function togglePageInteraction() {
  const layer = document.getElementById('draw-layer');
  const button = document.getElementById('page-interaction-btn');
  if (!layer) return;
  pageInteraction = !pageInteraction;
  layer.classList.toggle('page-interaction', pageInteraction);
  if (button) {
    button.classList.toggle('active', pageInteraction);
    button.title = pageInteraction ? 'Çizim moduna dön' : 'Sayfayı Kullan';
  }
  if (pageInteraction) {
    drawing = false;
    isSelecting = false;
    isShapeDrawing = false;
    activePointerId = null;
  }
}

function setBoardMode(mode, customColor) {
  const layer = document.getElementById('draw-layer');
  if (!layer) return;
  layer.classList.add('active');
  layer.style.backgroundImage = 'none';
  boardMode = mode;
  boardCustomColor = customColor || boardCustomColor;
  writeStorage('anka-board-mode', boardMode);
  writeStorage('anka-board-color', boardCustomColor);

  switch (mode) {
    case 'transparent':
      layer.style.backgroundColor = 'transparent';
      break;
    case 'white':
      layer.style.backgroundColor = '#ffffff';
      break;
    case 'black':
      layer.style.backgroundColor = '#121215';
      break;
    case 'dot':
      layer.style.backgroundColor = '#ffffff';
      layer.style.backgroundImage = 'radial-gradient(#d4d4d8 1.5px, transparent 1.5px)';
      layer.style.backgroundSize = '24px 24px';
      break;
    case 'lined':
      layer.style.backgroundColor = '#ffffff';
      layer.style.backgroundImage = 'linear-gradient(#e0e0ff 1px, transparent 1px)';
      layer.style.backgroundSize = '100% 35px';
      break;
    case 'grid':
      layer.style.backgroundColor = '#ffffff';
      layer.style.backgroundImage = 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)';
      layer.style.backgroundSize = '30px 30px';
      break;
    case 'isometric':
      layer.style.backgroundColor = '#ffffff';
      layer.style.backgroundImage = 'linear-gradient(30deg, #dbe4ee 1px, transparent 1px), linear-gradient(150deg, #dbe4ee 1px, transparent 1px)';
      layer.style.backgroundSize = '28px 48px';
      break;
    case 'music':
      layer.style.backgroundColor = '#fffdf7';
      layer.style.backgroundImage = 'linear-gradient(#cbd5e1 1px, transparent 1px)';
      layer.style.backgroundSize = '100% 9px';
      break;
    case 'map':
      layer.style.backgroundColor = '#edf6ec';
      layer.style.backgroundImage = 'linear-gradient(115deg, transparent 0 48%, rgba(34, 97, 64, .18) 49% 51%, transparent 52%), linear-gradient(25deg, transparent 0 48%, rgba(34, 97, 64, .14) 49% 51%, transparent 52%)';
      layer.style.backgroundSize = '110px 90px, 150px 120px';
      break;
    case 'custom':
      layer.style.backgroundColor = customColor || '#ffffff';
      break;
    default:
      layer.style.backgroundColor = 'transparent';
      break;
  }

  document.querySelectorAll('.bg-btn').forEach((button) => button.classList.remove('active'));
  const activeBg = document.querySelector(`[data-bg="${mode}"]`);
  if (activeBg) activeBg.classList.add('active');
}

function toggleBoardMode() {
  setBoardMode(boardMode === 'transparent' ? 'white' : 'transparent');
}

function drawBoardBackground(targetCtx, width, height) {
  if (boardMode === 'transparent') return;
  targetCtx.fillStyle = boardMode === 'black' ? '#121215' : (boardMode === 'custom' ? boardCustomColor : (boardMode === 'music' ? '#fffdf7' : (boardMode === 'map' ? '#edf6ec' : '#ffffff')));
  targetCtx.fillRect(0, 0, width, height);
  targetCtx.lineWidth = 1;
  if (boardMode === 'dot') {
    targetCtx.fillStyle = '#d4d4d8';
    for (let y = 8; y < height; y += 24) for (let x = 8; x < width; x += 24) targetCtx.fillRect(x, y, 2, 2);
  } else if (boardMode === 'lined' || boardMode === 'music') {
    targetCtx.strokeStyle = boardMode === 'music' ? '#cbd5e1' : '#e0e0ff';
    const step = boardMode === 'music' ? 9 : 35;
    for (let y = step; y < height; y += step) {
      targetCtx.beginPath();
      targetCtx.moveTo(0, y + 0.5);
      targetCtx.lineTo(width, y + 0.5);
      targetCtx.stroke();
    }
  } else if (boardMode === 'grid') {
    targetCtx.strokeStyle = '#eeeeee';
    for (let y = 30; y < height; y += 30) {
      targetCtx.beginPath();
      targetCtx.moveTo(0, y + 0.5);
      targetCtx.lineTo(width, y + 0.5);
      targetCtx.stroke();
    }
    for (let x = 30; x < width; x += 30) {
      targetCtx.beginPath();
      targetCtx.moveTo(x + 0.5, 0);
      targetCtx.lineTo(x + 0.5, height);
      targetCtx.stroke();
    }
  } else if (boardMode === 'isometric') {
    targetCtx.strokeStyle = '#dbe4ee';
    for (let x = -height; x < width + height; x += 28) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x + height / 1.7, height);
      targetCtx.stroke();
    }
    for (let x = 0; x < width + height; x += 28) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x - height / 1.7, height);
      targetCtx.stroke();
    }
  } else if (boardMode === 'map') {
    targetCtx.strokeStyle = 'rgba(34, 97, 64, .18)';
    for (let x = -height; x < width + height; x += 110) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x + height * 0.45, height);
      targetCtx.stroke();
    }
    for (let x = 0; x < width + height; x += 150) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x - height * 0.35, height);
      targetCtx.stroke();
    }
  }
}

function buildBoardImage() {
  const output = document.createElement('canvas');
  output.width = canvas.width;
  output.height = canvas.height;
  const outputCtx = output.getContext('2d');
  drawBoardBackground(outputCtx, output.width, output.height);
  outputCtx.drawImage(canvas, 0, 0);
  return output;
}

function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadCanvasImage(source, filename) {
  if (typeof source.toBlob === 'function') {
    source.toBlob((blob) => downloadBlob(blob, filename), 'image/png');
  } else {
    const link = document.createElement('a');
    link.download = filename;
    link.href = source.toDataURL('image/png');
    link.click();
  }
}

function exportBoard() {
  if (!canvas) return;
  downloadCanvasImage(buildBoardImage(), 'anka-cizim.png');
}

async function takeBoardScreenshot() {
  if (tool === 'select') {
    if (typeof showToast === 'function') showToast('Alan seçmek için sayfada sürükleyin.');
    return;
  }
  const ipc = getPaintIpc();
  if (ipc && typeof ipc.invoke === 'function') {
    try {
      const filePath = await ipc.invoke('capture-app-screen');
      if (filePath) {
        if (typeof showToast === 'function') showToast('Ekran görüntüsü Resimler klasörüne kaydedildi.');
        return;
      }
    } catch (error) {}
  }
  exportBoard();
}

function savePenFile() {
  if (!canvas) return;
  const payload = {
    version: 1,
    boardMode,
    boardCustomColor,
    image: canvas.toDataURL('image/png'),
    settings: {
      tool,
      color: (document.getElementById('p-color') || {}).value || '#ff4757',
      width: (document.getElementById('p-width') || {}).value || '4',
      opacity: (document.getElementById('p-opacity') || {}).value || '100'
    }
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/x-anka-pen' });
  downloadBlob(blob, 'anka-ders.pen');
  if (typeof showToast === 'function') showToast('.pen dosyası kaydedildi.');
}

function loadPenFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload || typeof payload.image !== 'string') throw new Error('invalid-pen');
      const image = new Image();
      image.onload = () => {
        saveState();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        try { setPersistentState(canvas.toDataURL('image/png')); } catch (error) {}
        if (payload.boardMode) setBoardMode(payload.boardMode, payload.boardCustomColor);
        const settings = payload.settings || {};
        const colorEl = document.getElementById('p-color');
        const widthEl = document.getElementById('p-width');
        const opacityEl = document.getElementById('p-opacity');
        if (settings.color && colorEl) colorEl.value = settings.color;
        if (settings.width && widthEl) widthEl.value = settings.width;
        if (settings.opacity && opacityEl) opacityEl.value = settings.opacity;
        if (settings.tool) setTool(settings.tool);
        persistDrawing();
        if (typeof showToast === 'function') showToast('.pen dosyası açıldı.');
      };
      image.onerror = () => {
        if (typeof showToast === 'function') showToast('Geçersiz .pen dosyası', 'error');
      };
      image.src = payload.image;
    } catch (error) {
      if (typeof showToast === 'function') showToast('Geçersiz .pen dosyası', 'error');
    }
  };
  reader.onerror = () => {
    if (typeof showToast === 'function') showToast('.pen dosyası okunamadı', 'error');
  };
  reader.readAsText(file);
  if (event.target) event.target.value = '';
}

function exportBoardPdf() {
  if (!canvas) return;
  const image = buildBoardImage().toDataURL('image/png');
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    if (typeof showToast === 'function') showToast('PDF penceresi açılamadı', 'error');
    return;
  }
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Anka Web Çizimi</title><style>html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto}</style></head><body><img src="${image}" alt="Anka Web çizimi"></body></html>`);
  printWindow.document.close();
  printWindow.addEventListener('load', () => {
    printWindow.focus();
    printWindow.print();
  });
}

function paintCaptureBackground(targetCtx, width, height, pageImage) {
  if (boardMode === 'transparent') {
    targetCtx.drawImage(pageImage, 0, 0);
    return;
  }
  targetCtx.fillStyle = boardMode === 'black' ? '#121215' : (boardMode === 'custom' ? boardCustomColor : '#ffffff');
  targetCtx.fillRect(0, 0, width, height);
  if (boardMode === 'dot') {
    targetCtx.fillStyle = '#d4d4d8';
    for (let y = 8; y < height; y += 24) for (let x = 8; x < width; x += 24) targetCtx.fillRect(x, y, 2, 2);
  } else if (boardMode === 'lined') {
    targetCtx.strokeStyle = '#e0e0ff';
    targetCtx.lineWidth = 1;
    for (let y = 35; y < height; y += 35) {
      targetCtx.beginPath();
      targetCtx.moveTo(0, y + 0.5);
      targetCtx.lineTo(width, y + 0.5);
      targetCtx.stroke();
    }
  } else if (boardMode === 'grid') {
    targetCtx.strokeStyle = '#eeeeee';
    targetCtx.lineWidth = 1;
    for (let y = 30; y < height; y += 30) {
      targetCtx.beginPath();
      targetCtx.moveTo(0, y + 0.5);
      targetCtx.lineTo(width, y + 0.5);
      targetCtx.stroke();
    }
    for (let x = 30; x < width; x += 30) {
      targetCtx.beginPath();
      targetCtx.moveTo(x + 0.5, 0);
      targetCtx.lineTo(x + 0.5, height);
      targetCtx.stroke();
    }
  }
}

function resizeCaptureCanvas() {
  if (!captureImage || !captureCanvas || !captureImage.naturalWidth) return;
  captureCanvas.style.width = captureImage.clientWidth + 'px';
  captureCanvas.style.height = captureImage.clientHeight + 'px';
  captureCanvas.style.left = captureImage.offsetLeft + 'px';
  captureCanvas.style.top = captureImage.offsetTop + 'px';
}

function updateCaptureZoom() {
  if (!captureImage || !captureImage.naturalWidth) return;
  captureImage.style.maxWidth = 'none';
  captureImage.style.maxHeight = 'none';
  captureCanvas.style.maxWidth = 'none';
  captureCanvas.style.maxHeight = 'none';
  captureImage.style.width = Math.round(captureImage.naturalWidth * captureZoom) + 'px';
  captureImage.style.height = Math.round(captureImage.naturalHeight * captureZoom) + 'px';
  requestAnimationFrame(resizeCaptureCanvas);
}

function setCaptureZoom(nextZoom) {
  captureZoom = Math.max(0.5, Math.min(4, Number(nextZoom) || 1));
  updateCaptureZoom();
}

function openCaptureWorkspace(dataUrl, sourceRect) {
  if (!captureWorkspace || !captureImage || !captureCanvas || !captureCtx) return;
  captureSourceRect = sourceRect || null;
  captureZoom = 1;
  const pageImage = new Image();
  pageImage.onload = () => {
    const composite = document.createElement('canvas');
    composite.width = pageImage.naturalWidth;
    composite.height = pageImage.naturalHeight;
    const compositeCtx = composite.getContext('2d');
    paintCaptureBackground(compositeCtx, composite.width, composite.height, pageImage);
    if (sourceRect && canvas.width > 0 && canvas.height > 0) {
      const canvasRect = getCanvasRect();
      const scaleX = canvas.width / Math.max(1, canvasRect.width);
      const scaleY = canvas.height / Math.max(1, canvasRect.height);
      compositeCtx.drawImage(
        canvas,
        sourceRect.x * scaleX,
        sourceRect.y * scaleY,
        sourceRect.width * scaleX,
        sourceRect.height * scaleY,
        0,
        0,
        composite.width,
        composite.height
      );
    }
    captureImage.onload = () => {
      captureCanvas.width = captureImage.naturalWidth;
      captureCanvas.height = captureImage.naturalHeight;
      captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
      resizeCaptureCanvas();
      updateCaptureZoom();
    };
    captureImage.src = composite.toDataURL('image/png');
    captureWorkspace.hidden = false;
    document.body.classList.add('capture-active');
    const drawLayer = document.getElementById('draw-layer');
    if (drawLayer) drawLayer.classList.remove('active');
    requestAnimationFrame(resizeCaptureCanvas);
  };
  pageImage.onerror = () => {
    if (typeof showToast === 'function') showToast('Görüntü yüklenemedi', 'error');
  };
  pageImage.src = dataUrl;
}

async function captureSelectedPage(x, y, width, height) {
  const target = getActivePageView();
  const viewContainer = document.getElementById('wv-container');
  if (!target || !viewContainer || typeof target.capturePage !== 'function') {
    if (typeof showToast === 'function') showToast('Bu sayfa yakalanamıyor', 'error');
    return;
  }
  const canvasRect = getCanvasRect();
  const viewRect = viewContainer.getBoundingClientRect();
  const selectionRect = {
    left: canvasRect.left + x,
    top: canvasRect.top + y,
    right: canvasRect.left + x + width,
    bottom: canvasRect.top + y + height
  };
  const left = Math.max(selectionRect.left, viewRect.left);
  const top = Math.max(selectionRect.top, viewRect.top);
  const right = Math.min(selectionRect.right, viewRect.right);
  const bottom = Math.min(selectionRect.bottom, viewRect.bottom);
  if (right - left < 12 || bottom - top < 12) return;

  try {
    const image = await target.capturePage({
      x: Math.round(left - viewRect.left),
      y: Math.round(top - viewRect.top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    });
    if (!image || typeof image.toDataURL !== 'function') throw new Error('capture-failed');
    openCaptureWorkspace(image.toDataURL(), {
      x: Math.max(0, left - canvasRect.left),
      y: Math.max(0, top - canvasRect.top),
      width: right - left,
      height: bottom - top
    });
  } catch (error) {
    if (typeof showToast === 'function') showToast('Seçilen alan alınamadı', 'error');
  }
}

function closeCaptureWorkspace() {
  if (!captureWorkspace) return;
  captureWorkspace.hidden = true;
  document.body.classList.remove('capture-active');
  captureDrawing = false;
  captureShapeDrawing = false;
  capturePointers.clear();
  capturePinchDistance = 0;
  captureSourceRect = null;
  captureZoom = 1;
  captureReturnState = null;
  captureShapeSnapshot = null;
  const drawLayer = document.getElementById('draw-layer');
  if (drawLayer) drawLayer.classList.add('active');
}

function zoomCapturedArea() {
  if (!captureSourceRect) return;
  const source = { ...captureSourceRect };
  captureReturnState = {
    image: captureImage ? captureImage.src : '',
    drawing: captureCanvas && captureCanvas.width > 0 ? captureCanvas.toDataURL('image/png') : '',
    source
  };
  if (captureWorkspace) captureWorkspace.hidden = true;
  document.body.classList.remove('capture-active');
  captureDrawing = false;
  captureShapeDrawing = false;
  capturePointers.clear();
  capturePinchDistance = 0;
  captureShapeSnapshot = null;
  const drawLayer = document.getElementById('draw-layer');
  if (drawLayer) drawLayer.classList.add('active');
  zoomPageFromSelection(source.x, source.y, source.width, source.height);
}

function reopenCapturedWorkspace() {
  const saved = captureReturnState;
  if (!saved || !saved.image || !captureWorkspace || !captureImage || !captureCanvas || !captureCtx) return;
  captureSourceRect = saved.source;
  captureZoom = 1;
  captureWorkspace.hidden = false;
  document.body.classList.add('capture-active');
  const drawLayer = document.getElementById('draw-layer');
  if (drawLayer) drawLayer.classList.remove('active');
  captureImage.onload = () => {
    captureCanvas.width = captureImage.naturalWidth;
    captureCanvas.height = captureImage.naturalHeight;
    captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    if (saved.drawing) {
      const drawingImage = new Image();
      drawingImage.onload = () => { try { captureCtx.drawImage(drawingImage, 0, 0); } catch (error) {} };
      drawingImage.src = saved.drawing;
    }
    resizeCaptureCanvas();
    updateCaptureZoom();
  };
  captureImage.src = saved.image;
  pageViewSnapshot = null;
  updatePageRestoreButton();
}

function clearCaptureDrawing() {
  if (!captureCtx || !captureCanvas || !captureImage) return;
  captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
  captureDrawing = false;
  captureShapeDrawing = false;
  captureShapeSnapshot = null;
  if (paintOpen) {
    const menu = document.getElementById('paint-menu');
    if (menu) menu.style.display = 'flex';
  }
}

function exportCapture() {
  if (!captureCanvas || !captureImage) return;
  const output = document.createElement('canvas');
  output.width = captureCanvas.width;
  output.height = captureCanvas.height;
  const outputCtx = output.getContext('2d');
  try {
    outputCtx.drawImage(captureImage, 0, 0, output.width, output.height);
    outputCtx.drawImage(captureCanvas, 0, 0);
  } catch (error) {
    return;
  }
  downloadCanvasImage(output, 'anka-yakalanan-alan.png');
}

function getActivePageView() {
  if (typeof activeView !== 'function') return null;
  try { return activeView(); } catch (error) { return null; }
}

function setPageZoom(nextZoom, view) {
  const target = view || getActivePageView();
  if (!target || typeof target.setZoomFactor !== 'function') return;
  pageZoom = Math.max(0.5, Math.min(3, Number(nextZoom) || 1));
  try { target.setZoomFactor(pageZoom); } catch (error) {}
}

async function zoomPageFromSelection(x, y, width, height) {
  const target = getActivePageView();
  if (!target) return;
  const viewContainer = document.getElementById('wv-container');
  const viewRect = viewContainer ? viewContainer.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  const selectionCenterX = x + width / 2;
  const selectionCenterY = y + height / 2;
  const zoomFactor = Math.max(1.25, Math.min(3, viewRect.width / Math.max(width, 120)));
  const nextZoom = Math.max(pageZoom, zoomFactor);

  if (typeof target.executeJavaScript === 'function') {
    try {
      const state = await target.executeJavaScript('({ x: window.scrollX || 0, y: window.scrollY || 0, width: window.innerWidth || 1, height: window.innerHeight || 1 })');
      const currentZoom = typeof target.getZoomFactor === 'function' ? Number(target.getZoomFactor()) || pageZoom : pageZoom;
      pageViewSnapshot = { zoom: currentZoom, scrollX: Number(state.x) || 0, scrollY: Number(state.y) || 0 };
      const contentX = (Number(state.x) || 0) + selectionCenterX / currentZoom;
      const contentY = (Number(state.y) || 0) + selectionCenterY / currentZoom;
      setPageZoom(nextZoom, target);
      const nextScrollX = Math.max(0, contentX - (Number(state.width) || viewRect.width) / 2);
      const nextScrollY = Math.max(0, contentY - (Number(state.height) || viewRect.height) / 2);
      await target.executeJavaScript(`window.scrollTo(${Math.round(nextScrollX)}, ${Math.round(nextScrollY)})`);
      updatePageRestoreButton();
      return;
    } catch (error) {}
  }

  const previousZoom = pageZoom;
  setPageZoom(nextZoom, target);
  pageViewSnapshot = { zoom: previousZoom, scrollX: 0, scrollY: 0 };
  updatePageRestoreButton();
}

function zoomPageIn() { setPageZoom(pageZoom + 0.25); }
function zoomPageOut() { setPageZoom(pageZoom - 0.25); }
function resetPageZoom() { setPageZoom(1); }

async function restorePageView() {
  const target = getActivePageView();
  const snapshot = pageViewSnapshot;
  if (!snapshot || !target) {
    resetPageZoom();
    reopenCapturedWorkspace();
    updatePageRestoreButton();
    return;
  }
  setPageZoom(snapshot.zoom, target);
  if (typeof target.executeJavaScript === 'function') {
    try { await target.executeJavaScript(`window.scrollTo(${Math.round(snapshot.scrollX)}, ${Math.round(snapshot.scrollY)})`); } catch (error) {}
  }
  pageViewSnapshot = null;
  reopenCapturedWorkspace();
  updatePageRestoreButton();
}

function updatePageRestoreButton() {
  const button = document.getElementById('page-zoom-reset');
  if (button) button.hidden = !pageViewSnapshot;
}

function toggleMathTool(toolId) {
  const element = document.getElementById(toolId);
  if (!element) return;
  if (getComputedStyle(element).display === 'none') {
    element.style.display = 'block';
    if (!element.dataset.initialized) {
      element.style.top = '200px';
      element.style.left = '300px';
      element.dataset.rotation = '0';
      element.dataset.scale = '1';
      element.dataset.initialized = 'true';
    }
    updateToolTransform(element);
    fitMathTool(element);
  } else {
    element.style.display = 'none';
  }
}

function toolRotate(e, toolId) {
  if (e && e.stopPropagation) e.stopPropagation();
  const element = document.getElementById(toolId);
  if (!element) return;
  let rotation = parseInt(element.dataset.rotation || '0', 10);
  rotation = (rotation + 15) % 360;
  element.dataset.rotation = rotation;
  updateToolTransform(element);
}

function toolScale(e, toolId, delta = 0.2) {
  if (e && e.stopPropagation) e.stopPropagation();
  const element = document.getElementById(toolId);
  if (!element) return;
  let scale = parseFloat(element.dataset.scale || '1');
  scale = Math.max(0.6, Math.min(2.4, scale + delta));
  element.dataset.scale = scale;
  updateToolTransform(element);
  fitMathTool(element);
}

function resetMathTool(e, toolId) {
  if (e && e.stopPropagation) e.stopPropagation();
  const element = document.getElementById(toolId);
  if (!element) return;
  element.dataset.rotation = '0';
  element.dataset.scale = '1';
  element.style.marginLeft = '0';
  element.style.left = Math.max(8, (window.innerWidth - element.offsetWidth) / 2) + 'px';
  element.style.top = toolId === 'ruler' ? '170px' : '250px';
  updateToolTransform(element);
  fitMathTool(element);
}

function updateToolTransform(element) {
  const rotation = element.dataset.rotation || '0';
  const scale = element.dataset.scale || '1';
  element.style.transform = `rotate(${rotation}deg) scale(${scale})`;
}

function fitMathTool(element) {
  if (!element || getComputedStyle(element).display === 'none') return;
  const rect = element.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - rect.width - 8));
  const top = Math.min(Math.max(48, rect.top), Math.max(48, window.innerHeight - rect.height - 8));
  const currentLeft = parseFloat(getComputedStyle(element).left) || 0;
  const currentTop = parseFloat(getComputedStyle(element).top) || 0;
  element.style.left = currentLeft + left - rect.left + 'px';
  element.style.top = currentTop + top - rect.top + 'px';
}

function setupProtractorScale() {
  const body = document.querySelector('#protractor .protractor-body');
  if (!body) return;
  const labels = body.querySelectorAll('span');
  labels.forEach((label, index) => {
    const angle = index * 10;
    const radians = (angle * Math.PI) / 180;
    label.textContent = String(angle);
    label.style.left = `${50 - 47 * Math.cos(radians)}%`;
    label.style.bottom = `${10 + Math.sin(radians) * 82}px`;
  });
}

function setupRulerScale() {
  const ticks = document.querySelector('#ruler .ruler-ticks');
  if (!ticks) return;
  const fragment = document.createDocumentFragment();
  for (let millimeter = 0; millimeter <= 100; millimeter += 1) {
    const tick = document.createElement('i');
    tick.style.left = `${millimeter}%`;
    tick.className = millimeter % 10 === 0 ? 'major' : (millimeter % 5 === 0 ? 'half' : 'minor');
    fragment.appendChild(tick);
  }
  ticks.replaceChildren(fragment);
}

function bindMathToolDragging() {
  ['ruler', 'protractor'].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    let draggingTool = false;
    let pointerId = null;
    let startXVal = 0;
    let startYVal = 0;
    let initialX = 0;
    let initialY = 0;

    element.addEventListener('pointerdown', (event) => {
      if (event.target.tagName === 'BUTTON' || event.target.classList.contains('c-btn')) return;
      draggingTool = true;
      pointerId = event.pointerId;
      startXVal = event.clientX;
      startYVal = event.clientY;
      const computed = getComputedStyle(element);
      initialX = parseFloat(computed.left) || element.getBoundingClientRect().left;
      initialY = parseFloat(computed.top) || element.getBoundingClientRect().top;
      try { element.setPointerCapture(event.pointerId); } catch (error) {}
      event.stopPropagation();
    });

    element.addEventListener('pointermove', (event) => {
      if (!draggingTool || event.pointerId !== pointerId) return;
      const dx = event.clientX - startXVal;
      const dy = event.clientY - startYVal;
      element.style.left = (initialX + dx) + 'px';
      element.style.top = (initialY + dy) + 'px';
      fitMathTool(element);
    });

    const finishDrag = (event) => {
      if (!draggingTool || event.pointerId !== pointerId) return;
      draggingTool = false;
      pointerId = null;
      try { element.releasePointerCapture(event.pointerId); } catch (error) {}
    };

    element.addEventListener('pointerup', finishDrag);
    element.addEventListener('pointercancel', finishDrag);
    element.addEventListener('lostpointercapture', () => {
      draggingTool = false;
      pointerId = null;
    });
  });
}

if (canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    if (!paintOpen || activePointerId !== null || event.button !== 0) return;
    activePointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
    invalidateRect();
    startDrawing(event, event.clientX, event.clientY);
  }, { passive: false });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointerId) return;
    if (typeof event.getCoalescedEvents === 'function') {
      const coalesced = event.getCoalescedEvents();
      if (coalesced && coalesced.length > 0) {
        for (let index = 0; index < coalesced.length; index++) draw(event, coalesced[index].clientX, coalesced[index].clientY);
        return;
      }
    }
    draw(event, event.clientX, event.clientY);
  }, { passive: true });

  const finishPointerDrawing = (event) => {
    if (event.pointerId !== activePointerId) return;
    stopDrawing(event);
    activePointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch (error) {}
  };

  canvas.addEventListener('pointerup', finishPointerDrawing);
  canvas.addEventListener('pointercancel', finishPointerDrawing);
  canvas.addEventListener('lostpointercapture', () => {
    drawing = false;
    isSelecting = false;
    isShapeDrawing = false;
    shapeSnapshot = null;
    pendingShapePoint = null;
    if (shapeFrameId) cancelAnimationFrame(shapeFrameId);
    shapeFrameId = 0;
    activePointerId = null;
  });

  canvas.addEventListener('pointermove', updatePaintCursor, { passive: true });
  canvas.addEventListener('pointerenter', updatePaintCursor, { passive: true });
  canvas.addEventListener('pointerleave', hidePaintCursor, { passive: true });
  canvas.addEventListener('pointerup', hidePaintCursor, { passive: true });
}

const paintMenuEl = document.getElementById('paint-menu');
if (paintMenuEl) paintMenuEl.addEventListener('click', (event) => event.stopPropagation());

const opacityControl = document.getElementById('p-opacity');
if (opacityControl) opacityControl.addEventListener('input', applyStyles);

const paintCategoryTablist = document.querySelector('#paint-menu [role="tablist"]');
if (paintCategoryTablist) {
  paintCategoryTablist.addEventListener('keydown', (event) => {
    const currentTab = event.target.closest('[data-paint-tab]');
    if (!currentTab) return;
    const tabs = Array.from(paintCategoryTablist.querySelectorAll('[data-paint-tab]'));
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[nextIndex].focus();
    selectPaintCategory(tabs[nextIndex].dataset.paintTab);
  });
}

document.querySelectorAll('.favorite-color').forEach((button) => {
  button.addEventListener('click', () => {
    const color = button.dataset.color;
    const colorInput = document.getElementById('p-color');
    if (!colorInput || !color) return;
    colorInput.value = color;
    document.querySelectorAll('.favorite-color').forEach((item) => item.classList.toggle('active', item === button));
    applyStyles();
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pageZoom !== 1) resetPageZoom();
  if (event.target && typeof event.target.matches === 'function' && event.target.matches('input, textarea, select')) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }
  if (!modifier) return;
  if (event.key === '+' || event.key === '=' || event.key === 'Add') {
    event.preventDefault();
    zoomPageIn();
  } else if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
    event.preventDefault();
    zoomPageOut();
  } else if (event.key === '0') {
    event.preventDefault();
    resetPageZoom();
  }
});

window.addEventListener('resize', () => {
  invalidateRect();
  initCanvas();
  resizeCaptureCanvas();
  fitMathTool(document.getElementById('ruler'));
  fitMathTool(document.getElementById('protractor'));
}, { passive: true });

window.addEventListener('beforeunload', flushPersistence);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPersistence();
});

if (captureCanvas) {
  captureCanvas.addEventListener('pointerdown', (event) => {
    if (!captureWorkspace || captureWorkspace.hidden || event.button !== 0) return;
    capturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (capturePointers.size > 1) {
      captureDrawing = false;
      captureShapeDrawing = false;
      captureShapeSnapshot = null;
      const points = [...capturePointers.values()];
      capturePinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      return;
    }
    const point = getCaptureCoordinates(event.clientX, event.clientY);
    try { captureCanvas.setPointerCapture(event.pointerId); } catch (error) {}
    if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      captureShapeDrawing = true;
      captureShapeStartX = point.x;
      captureShapeStartY = point.y;
      try { captureShapeSnapshot = captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height); } catch (error) { captureShapeSnapshot = null; }
      return;
    }
    captureDrawing = true;
    applyCaptureStyles();
    captureCtx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    captureCtx.beginPath();
    captureCtx.moveTo(point.x, point.y);
  });

  captureCanvas.addEventListener('pointermove', (event) => {
    if (capturePointers.has(event.pointerId)) capturePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (capturePointers.size > 1) {
      const points = [...capturePointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (capturePinchDistance > 0) setCaptureZoom(captureZoom * distance / capturePinchDistance);
      capturePinchDistance = distance;
      return;
    }
    if (!captureDrawing && !captureShapeDrawing) return;
    const point = getCaptureCoordinates(event.clientX, event.clientY);
    if (captureShapeDrawing && captureShapeSnapshot) {
      try { captureCtx.putImageData(captureShapeSnapshot, 0, 0); } catch (error) {}
      captureDrawShape(captureShapeStartX, captureShapeStartY, point.x, point.y);
      return;
    }
    captureCtx.lineTo(point.x, point.y);
    captureCtx.stroke();
  });

  const finishCaptureDrawing = (event) => {
    capturePointers.delete(event.pointerId);
    if (capturePointers.size === 0) capturePinchDistance = 0;
    if (!captureDrawing && !captureShapeDrawing) return;
    if (captureDrawing) {
      try { captureCtx.closePath(); } catch (error) {}
    }
    captureDrawing = false;
    captureShapeDrawing = false;
    captureShapeSnapshot = null;
    try { captureCanvas.releasePointerCapture(event.pointerId); } catch (error) {}
  };

  captureCanvas.addEventListener('pointerup', finishCaptureDrawing);
  captureCanvas.addEventListener('pointercancel', finishCaptureDrawing);
  captureCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    setCaptureZoom(captureZoom + (event.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });
}

setupProtractorScale();
setupRulerScale();
bindMathToolDragging();

const savedBoardMode = readStorage('anka-board-mode', null);
const savedBoardColor = readStorage('anka-board-color', '#ffffff');
if (savedBoardMode) setBoardMode(savedBoardMode, savedBoardColor);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePaintSurface, { once: true });
} else {
  initializePaintSurface();
}

restoreDrawing();