// Dock shell: three states — "rail" (slim strip), "open" (docked side panel),
// and "float" (a draggable, resizable window over the board) — plus edge-drag
// resizing, persistence, and the activity badge that blinks on the rail while
// the copilot works elsewhere.
import { $ } from '../lib/dom.js';
import { DOCK_UI, STORAGE_KEYS } from '../constants.js';
import { setKeyHandler, pushEscLayer } from '../keys.js';
import { refreshGridWidth } from '../board/board.js';
import { subscribe } from '../state/store.js';

const dock = $('#dock');
const narrow = window.matchMedia('(max-width: 900px)'); // dock becomes a sheet; no floating there
let width = DOCK_UI.defaultWidth;
let composerH = 0; // 0 = the CSS default; set by dragging the composer's top edge
let float = {}; // floating-window geometry { x, y, w, h }
let lastExpanded = 'open'; // which expanded mode Ctrl+J/✦ returns to
let popEsc = null;
let sizeTimer = null;

function clampWidth(w) {
  return Math.min(Math.max(w, DOCK_UI.minWidth), Math.round(window.innerWidth * DOCK_UI.maxViewportFraction));
}

function clampComposerH(h) {
  return Math.min(Math.max(h, DOCK_UI.composerMinHeight), Math.round(window.innerHeight * DOCK_UI.composerMaxViewportFraction));
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.dock, JSON.stringify({ state: dock.dataset.state, width, composerH, float, lastExpanded }));
}

function applyWidth() {
  dock.style.setProperty('--dock-w', `${clampWidth(width)}px`);
}

function applyComposerH() {
  if (composerH) dock.style.setProperty('--composer-h', `${clampComposerH(composerH)}px`);
}

// Place the floating window from saved geometry, clamped into the viewport
// (it may have been saved on a bigger screen).
function applyFloat() {
  if (narrow.matches) return; // the sheet layout owns geometry on small screens
  const w = Math.min(float.w || DOCK_UI.floatDefaultWidth, window.innerWidth - 16);
  const h = Math.min(float.h || Math.round(window.innerHeight * 0.72), window.innerHeight - 16);
  const x = Math.min(Math.max(float.x ?? (window.innerWidth - w - 24), 8), window.innerWidth - w - 8);
  const y = Math.min(Math.max(float.y ?? 72, 8), window.innerHeight - h - 8);
  Object.assign(dock.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

const mode = () => dock.dataset.state;
export const isOpen = () => mode() !== 'rail';

function setMode(next, { focus = false } = {}) {
  if (next === mode()) {
    if (focus) $('#dock-input').focus();
    return;
  }
  dock.dataset.state = next;
  // Native resize:both writes inline geometry; never let it leak across modes.
  Object.assign(dock.style, { left: '', top: '', width: '', height: '' });
  if (next === 'float') applyFloat();
  if (next === 'rail') {
    popEsc?.();
    popEsc = null;
  } else {
    lastExpanded = next;
    $('#dock-activity').classList.add('hidden');
    // Esc inside the dock: blur the composer first, then collapse.
    if (!popEsc) popEsc = pushEscLayer(() => {
      const input = $('#dock-input');
      if (document.activeElement === input) input.blur();
      else collapseDock();
    });
  }
  const fbtn = $('#dock-float');
  fbtn.textContent = next === 'float' ? '⇤' : '⧉';
  fbtn.title = next === 'float' ? 'Dock to the side' : 'Pop out as a floating window';
  persist();
  refreshGridWidth();
  if (focus) $('#dock-input').focus();
}

export function openDock({ focus = true } = {}) {
  setMode(mode() === 'rail' ? lastExpanded : mode(), { focus });
}

export function collapseDock() {
  if (isOpen()) setMode('rail');
}

export const toggleDock = () => (isOpen() ? collapseDock() : openDock());

// Shared edge-drag plumbing. Ends the drag however it finishes: pointerup,
// pointercancel, or losing capture (alt-tab, releasing over browser chrome) —
// without these the dragging flag sticks and hovering the handle keeps
// resizing with no button held. Moves coalesce to one update per frame.
// onStart may veto by returning false (before any capture happens).
function wireDrag(el, { onStart, onMove, onEnd }) {
  let dragging = false;
  let raf = 0;
  let last = null;
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('active');
    onEnd?.();
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (onStart && onStart(e) === false) return;
    e.preventDefault(); // no text-selection sweep while dragging
    dragging = true;
    el.classList.add('active');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    last = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (dragging) onMove(last); });
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
}

function wireResizer() {
  wireDrag($('#dock-resizer'), {
    onMove: (e) => { width = clampWidth(window.innerWidth - e.clientX); applyWidth(); refreshGridWidth(); },
    onEnd: () => { persist(); refreshGridWidth(); },
  });
}

// Dragging the composer's top edge sets its resting height; the auto-grow in
// chat.js still expands it further when the draft outgrows that floor.
function wireComposerResizer() {
  const input = $('#dock-input');
  let start = null;
  wireDrag($('#dock-bar-resizer'), {
    onStart: (e) => { start = { y: e.clientY, h: composerH || input.offsetHeight }; },
    onMove: (e) => { composerH = clampComposerH(start.h + (start.y - e.clientY)); applyComposerH(); },
    onEnd: persist,
  });
}

// In float mode the header drags the window. Document-level listeners with no
// pointer capture (the cmdk-panel pattern): capture pins events to the handle
// element, which is exactly wrong for a handle that moves with the window.
// Buttons and the model picker keep working — they never start a drag.
function wireFloatDrag() {
  const head = $('.dock-head');
  let drag = null;
  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    const x = Math.min(Math.max(drag.left + (e.clientX - drag.x), 8), window.innerWidth - drag.w - 8);
    const y = Math.min(Math.max(drag.top + (e.clientY - drag.y), 8), window.innerHeight - 48);
    Object.assign(dock.style, { left: `${x}px`, top: `${y}px` });
  };
  const onUp = () => {
    if (!drag) return;
    drag = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    const r = dock.getBoundingClientRect();
    float.x = r.left;
    float.y = r.top;
    persist();
  };
  head.addEventListener('pointerdown', (e) => {
    if (mode() !== 'float' || e.button !== 0) return;
    if (e.target.closest('button, .model-picker')) return;
    e.preventDefault();
    const r = dock.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

export function initDock() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dock) || 'null');
    if (saved?.width) width = saved.width;
    if (saved?.composerH) composerH = saved.composerH;
    if (saved?.float) float = saved.float;
    if (saved?.lastExpanded === 'float') lastExpanded = 'float';
    if (saved?.state === 'open' || saved?.state === 'float') setMode(saved.state);
  } catch { /* corrupt */ }
  applyWidth();
  applyComposerH();

  $('#dock-expand').addEventListener('click', () => openDock());
  $('#dock-collapse').addEventListener('click', () => collapseDock());
  $('#dock-float').addEventListener('click', () => setMode(mode() === 'float' ? 'open' : 'float'));
  setKeyHandler('toggleDock', toggleDock);
  wireResizer();
  wireComposerResizer();
  wireFloatDrag();
  window.addEventListener('resize', () => {
    applyWidth();
    if (mode() === 'float') applyFloat(); // keep the window reachable
  });

  // The native resize grip writes inline width/height; remember them.
  new ResizeObserver(() => {
    if (mode() !== 'float') return;
    const r = dock.getBoundingClientRect();
    if (Math.abs(r.width - (float.w || 0)) < 1 && Math.abs(r.height - (float.h || 0)) < 1) return;
    float.w = r.width;
    float.h = r.height;
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(persist, 400);
  }).observe(dock);

  // Copilot activity from anywhere (another tab's run): blink the rail dot.
  subscribe('agent', (a) => {
    if (!isOpen() && a.phase !== 'done') $('#dock-activity').classList.remove('hidden');
  });
}
