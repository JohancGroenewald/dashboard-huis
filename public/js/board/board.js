// Board orchestration: GridStack init, full-rebuild rendering, layout
// persistence, and the layout controls in the ⋯ menu. Card content lives in
// cards.js / tiles.js.
//
// Ported behaviors from the old grid.js that must not regress:
// - `rendering` guard: GridStack fires 'change' while we rebuild; never
//   persist those.
// - collapsed sections render at h=1 but keep their real height in layout.h
//   so expanding restores it.
// - auto-arrange = float(false) + compact(); manual = float(true).
import { $ } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { GRID_UI, STORAGE_KEYS } from '../constants.js';
import { store, subscribe, publish, flushDeferred, applyDashboard } from '../state/store.js';
import { sectionInner, noteInner, ghostInner, wireSection, wireNote, wireGhost } from './cards.js';
import { gameInner, wireGame } from './games.js';
import { triggerInner, wireTrigger } from './triggers.js';

const gridEl = $('#board');
let grid = null;
let rendering = false;
let persistTimer = null;
let locked = false;
let cellH = Math.min(
  GRID_UI.cellHeightMax,
  Math.max(GRID_UI.cellHeightMin, Number(localStorage.getItem(STORAGE_KEYS.gridCellHeight)) || GRID_UI.cellHeightDefault)
);
let autoArrange = localStorage.getItem(STORAGE_KEYS.autoArrange) !== '0';
let showGrid = localStorage.getItem(STORAGE_KEYS.showGrid) === '1';
// Narrow screens stack everything in one column; layouts are never persisted
// in that mode, so the real 12-column positions survive untouched.
const oneColQuery = window.matchMedia(`(max-width: ${GRID_UI.oneColumnBelowPx}px)`);
let oneColumn = false;

// True while the user is mid-interaction on the board — remote updates are
// deferred (state/store.js) until this clears.
export function isInteracting() {
  if (gridEl.querySelector('.ui-draggable-dragging, .ui-resizable-resizing')) return true;
  const a = document.activeElement;
  return Boolean(a && gridEl.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'));
}

// The dock resizes the board column; GridStack needs a nudge to re-measure.
export function refreshGridWidth() {
  grid?.onResize();
  updateGridOverlay();
}

function updateGridOverlay() {
  if (!grid || !showGrid) return;
  gridEl.style.backgroundSize = `${gridEl.clientWidth / GRID_UI.columns}px ${cellH}px`;
}

function persistLayout() {
  if (rendering || oneColumn) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const items = grid.save(false).map((n) => {
      const sec = store.dashboard.sections.find((s) => s.id === n.id);
      return { id: n.id, x: n.x, y: n.y, w: n.w, h: sec?.collapsed ? (sec.layout?.h || GRID_UI.sectionDefaultHeight) : n.h };
    });
    api('/api/layout', jsonBody({ items })).catch(() => {});
  }, GRID_UI.layoutPersistDebounceMs);
}

function widgetEl(id, layout, defW, defH, innerHtml) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.setAttribute('gs-id', id);
  el.setAttribute('gs-w', layout.w || defW);
  el.setAttribute('gs-h', layout.h || defH);
  if (Number.isInteger(layout.x) && Number.isInteger(layout.y)) {
    el.setAttribute('gs-x', layout.x);
    el.setAttribute('gs-y', layout.y);
  } else {
    el.setAttribute('gs-auto-position', 'true');
  }
  el.innerHTML = `<div class="grid-stack-item-content">${innerHtml}</div>`;
  return el;
}

function renderBoard() {
  if (!grid) return;
  rendering = true;
  // Rebuild with animation off so re-inserted cards don't visibly slide.
  // No batchUpdate here: batch mode defers removeAll, which left the old
  // workspace's cards in the DOM (every board overlaid on the previous one)
  // and skipped collision resolution.
  grid.setAnimation(false);
  grid.removeAll(true);

  const ws = store.dashboard.activeWorkspaceId;
  const sections = store.dashboard.sections.filter((s) => s.workspaceId === ws);
  const notes = store.dashboard.notes.filter((n) => n.workspaceId === ws);
  const games = (store.dashboard.games || []).filter((g) => g.workspaceId === ws);
  const triggers = (store.dashboard.triggers || []).filter((t) => t.workspaceId === ws);
  $('#empty-hero').classList.toggle('hidden', sections.length + notes.length + games.length + triggers.length > 0);

  const cab = $('#collapse-all');
  const allCollapsed = sections.length > 0 && sections.every((s) => s.collapsed);
  cab.textContent = allCollapsed ? '⊞ Expand all' : '⊟ Collapse all';
  cab.classList.toggle('hidden', sections.length === 0);

  for (const section of sections) {
    const layout = section.collapsed ? { ...(section.layout || {}), h: GRID_UI.collapsedHeight } : (section.layout || {});
    const el = widgetEl(section.id, layout, GRID_UI.sectionDefaultWidth, GRID_UI.sectionDefaultHeight, sectionInner(section));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireSection(el, section);
  }
  for (const note of notes) {
    const el = note.hidden
      ? widgetEl(note.id, note.layout || {}, GRID_UI.noteDefaultWidth, GRID_UI.noteDefaultHeight, ghostInner())
      : widgetEl(note.id, note.layout || {}, GRID_UI.noteDefaultWidth, GRID_UI.noteDefaultHeight, noteInner(note));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    if (note.hidden) wireGhost(el, note);
    else wireNote(el, note);
  }
  for (const game of games) {
    const el = widgetEl(game.id, game.layout || {}, GRID_UI.gameDefaultWidth, GRID_UI.gameDefaultHeight, gameInner(game));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireGame(el, game);
  }
  for (const trigger of triggers) {
    const el = widgetEl(trigger.id, trigger.layout || {}, GRID_UI.triggerDefaultWidth, GRID_UI.triggerDefaultHeight, triggerInner(trigger));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireTrigger(el, trigger);
  }
  requestAnimationFrame(() => grid.setAnimation(true));
  rendering = false;
  updateGridOverlay();
  publish('board-rendered');
}

function wireLayoutMenu() {
  const arrangeLabel = () => { $('#arrange-toggle').textContent = `🧲 Arrange: ${autoArrange ? 'on' : 'off'}`; };
  const snapLabel = () => {
    $('#snap-toggle').textContent = `⊞ Grid: ${showGrid ? 'on' : 'off'}`;
    gridEl.classList.toggle('show-grid', showGrid);
    updateGridOverlay();
  };
  const applyCellH = () => {
    $('#grid-size-val').textContent = String(cellH);
    grid.cellHeight(cellH);
    updateGridOverlay();
  };

  $('#collapse-all').addEventListener('click', async () => {
    const secs = store.dashboard.sections.filter((s) => s.workspaceId === store.dashboard.activeWorkspaceId);
    const anyExpanded = secs.some((s) => !s.collapsed);
    applyDashboard(await api('/api/sections/collapse', jsonBody({ collapsed: anyExpanded })));
  });
  $('#arrange-toggle').addEventListener('click', () => {
    autoArrange = !autoArrange;
    localStorage.setItem(STORAGE_KEYS.autoArrange, autoArrange ? '1' : '0');
    arrangeLabel();
    grid.float(!autoArrange);
    if (autoArrange) { grid.compact(); persistLayout(); }
  });
  $('#edit-toggle').addEventListener('click', () => {
    locked = !locked;
    grid.setStatic(locked);
    $('#edit-toggle').textContent = locked ? '🔒 Locked' : '🔓 Edit';
    gridEl.classList.toggle('locked', locked);
  });
  $('#snap-toggle').addEventListener('click', () => {
    showGrid = !showGrid;
    localStorage.setItem(STORAGE_KEYS.showGrid, showGrid ? '1' : '0');
    snapLabel();
  });
  $('#grid-smaller').addEventListener('click', () => {
    cellH = Math.max(GRID_UI.cellHeightMin, cellH - GRID_UI.cellHeightStep);
    localStorage.setItem(STORAGE_KEYS.gridCellHeight, cellH);
    applyCellH();
  });
  $('#grid-bigger').addEventListener('click', () => {
    cellH = Math.min(GRID_UI.cellHeightMax, cellH + GRID_UI.cellHeightStep);
    localStorage.setItem(STORAGE_KEYS.gridCellHeight, cellH);
    applyCellH();
  });

  arrangeLabel();
  snapLabel();
  applyCellH();
}

export function initBoard() {
  grid = GridStack.init(
    { column: GRID_UI.columns, cellHeight: cellH, margin: GRID_UI.margin, float: !autoArrange, handle: '.card-grip', animate: true },
    gridEl
  );
  grid.on('change', persistLayout);
  const applyColumns = () => {
    oneColumn = oneColQuery.matches;
    grid.column(oneColumn ? 1 : GRID_UI.columns, oneColumn ? 'list' : 'moveScale');
    updateGridOverlay();
  };
  oneColQuery.addEventListener('change', applyColumns);
  if (oneColQuery.matches) applyColumns();
  // A finished drag/resize or leaving an editable field releases any deferred
  // remote update.
  grid.on('dragstop resizestop', () => setTimeout(flushDeferred));
  gridEl.addEventListener('focusout', () => setTimeout(flushDeferred));
  window.addEventListener('resize', updateGridOverlay);

  wireLayoutMenu();
  subscribe('dashboard', renderBoard);
}
