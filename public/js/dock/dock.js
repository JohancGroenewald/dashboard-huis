// Dock shell: rail ↔ open states, edge-drag resizing, persistence, and the
// activity badge that blinks on the rail while the copilot works elsewhere.
import { $ } from '../lib/dom.js';
import { DOCK_UI, STORAGE_KEYS } from '../constants.js';
import { setKeyHandler, pushEscLayer } from '../keys.js';
import { refreshGridWidth } from '../board/board.js';
import { subscribe } from '../state/store.js';

const dock = $('#dock');
let width = DOCK_UI.defaultWidth;
let composerH = 0; // 0 = the CSS default; set by dragging the composer's top edge
let popEsc = null;

function clampWidth(w) {
  return Math.min(Math.max(w, DOCK_UI.minWidth), Math.round(window.innerWidth * DOCK_UI.maxViewportFraction));
}

function clampComposerH(h) {
  return Math.min(Math.max(h, DOCK_UI.composerMinHeight), Math.round(window.innerHeight * DOCK_UI.composerMaxViewportFraction));
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.dock, JSON.stringify({ state: dock.dataset.state, width, composerH }));
}

function applyWidth() {
  dock.style.setProperty('--dock-w', `${clampWidth(width)}px`);
}

function applyComposerH() {
  if (composerH) dock.style.setProperty('--composer-h', `${clampComposerH(composerH)}px`);
}

export const isOpen = () => dock.dataset.state === 'open';

export function openDock({ focus = true } = {}) {
  if (!isOpen()) {
    dock.dataset.state = 'open';
    $('#dock-activity').classList.add('hidden');
    persist();
    refreshGridWidth();
    // Esc inside the dock: blur the composer first, then collapse.
    popEsc = pushEscLayer(() => {
      const input = $('#dock-input');
      if (document.activeElement === input) input.blur();
      else collapseDock();
    });
  }
  if (focus) $('#dock-input').focus();
}

export function collapseDock() {
  if (!isOpen()) return;
  dock.dataset.state = 'rail';
  persist();
  refreshGridWidth();
  popEsc?.();
  popEsc = null;
}

export const toggleDock = () => (isOpen() ? collapseDock() : openDock());

// Shared edge-drag plumbing. Ends the drag however it finishes: pointerup,
// pointercancel, or losing capture (alt-tab, releasing over browser chrome) —
// without these the dragging flag sticks and hovering the handle keeps
// resizing with no button held. Moves coalesce to one update per frame.
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
    e.preventDefault(); // no text-selection sweep while dragging
    dragging = true;
    el.classList.add('active');
    el.setPointerCapture(e.pointerId);
    onStart?.(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    last = e;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; onMove(last); });
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

export function initDock() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dock) || 'null');
    if (saved?.width) width = saved.width;
    if (saved?.composerH) composerH = saved.composerH;
    if (saved?.state === 'open') { dock.dataset.state = 'open'; popEsc = pushEscLayer(() => collapseDock()); }
  } catch { /* corrupt */ }
  applyWidth();
  applyComposerH();

  $('#dock-expand').addEventListener('click', () => openDock());
  $('#dock-collapse').addEventListener('click', () => collapseDock());
  setKeyHandler('toggleDock', toggleDock);
  wireResizer();
  wireComposerResizer();
  window.addEventListener('resize', applyWidth);

  // Copilot activity from anywhere (another tab's run): blink the rail dot.
  subscribe('agent', (a) => {
    if (!isOpen() && a.phase !== 'done') $('#dock-activity').classList.remove('hidden');
  });
}
