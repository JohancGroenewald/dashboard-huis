// Dock shell: rail ↔ open states, edge-drag resizing, persistence, and the
// activity badge that blinks on the rail while the copilot works elsewhere.
import { $ } from '../lib/dom.js';
import { DOCK_UI, STORAGE_KEYS } from '../constants.js';
import { setKeyHandler, pushEscLayer } from '../keys.js';
import { refreshGridWidth } from '../board/board.js';
import { subscribe } from '../state/store.js';

const dock = $('#dock');
let width = DOCK_UI.defaultWidth;
let popEsc = null;

function clampWidth(w) {
  return Math.min(Math.max(w, DOCK_UI.minWidth), Math.round(window.innerWidth * DOCK_UI.maxViewportFraction));
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.dock, JSON.stringify({ state: dock.dataset.state, width }));
}

function applyWidth() {
  dock.style.setProperty('--dock-w', `${clampWidth(width)}px`);
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

function wireResizer() {
  const resizer = $('#dock-resizer');
  let dragging = false;
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    resizer.classList.add('active');
    resizer.setPointerCapture(e.pointerId);
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    width = clampWidth(window.innerWidth - e.clientX);
    applyWidth();
    refreshGridWidth();
  });
  resizer.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('active');
    resizer.releasePointerCapture(e.pointerId);
    persist();
    refreshGridWidth();
  });
}

export function initDock() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dock) || 'null');
    if (saved?.width) width = saved.width;
    if (saved?.state === 'open') { dock.dataset.state = 'open'; popEsc = pushEscLayer(() => collapseDock()); }
  } catch { /* corrupt */ }
  applyWidth();

  $('#dock-expand').addEventListener('click', () => openDock());
  $('#dock-collapse').addEventListener('click', () => collapseDock());
  setKeyHandler('toggleDock', toggleDock);
  wireResizer();
  window.addEventListener('resize', applyWidth);

  // Copilot activity from anywhere (another tab's run): blink the rail dot.
  subscribe('agent', (a) => {
    if (!isOpen() && a.phase !== 'done') $('#dock-activity').classList.remove('hidden');
  });
}
