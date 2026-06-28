// Workspace tabs + view switching. Content workspaces come from the dashboard
// state; system views (Models / Abilities / Requests / Logs) live behind the
// ⋯ menu and register an onActivate refresher here.
import { $, esc, toast } from './lib/dom.js';
import { api, jsonBody } from './lib/api.js';
import { openDialog } from './lib/dialog.js';
import { STORAGE_KEYS, WORKSPACE_TAB_TEXT_COLORS } from './constants.js';
import { store, subscribe, setView, switchWorkspace, loadDashboard, applyDashboard } from './state/store.js';
import { openPalette } from './board/palette.js';
import { refreshGridWidth } from './board/board.js';
import { openDock } from './dock/dock.js';

const systemViews = new Map(); // id -> onActivate
let draggingWs = null;
let suppressClickUntil = 0;
let activeShellTab = 'dashboard';

export function registerView(id, onActivate) {
  systemViews.set(id, onActivate);
}

export function showView(id) {
  setView(id);
  localStorage.setItem(STORAGE_KEYS.view, id);
  activeShellTab = id === 'models' ? 'models' : id === 'prompts' ? 'teach' : null;
  renderPrimaryTabs();
  systemViews.get(id)?.();
}

// Show the board, optionally jumping to another workspace (used by ⌘K).
export async function showBoardWorkspace(id, { shellTab = 'dashboard' } = {}) {
  activeShellTab = shellTab;
  setView('board');
  localStorage.setItem(STORAGE_KEYS.view, 'board');
  renderPrimaryTabs();
  if (id && id !== store.dashboard.activeWorkspaceId) await switchWorkspace(id);
}

function applyPanels() {
  $('#view-board').classList.toggle('hidden', store.view !== 'board');
  for (const id of systemViews.keys()) $(`#view-${id}`)?.classList.toggle('hidden', store.view !== id);
}

function currentShellTab() {
  if (store.view === 'models') return 'models';
  if (store.view === 'prompts') return 'teach';
  if (store.view === 'board') return activeShellTab === 'chat' ? 'chat' : 'dashboard';
  return null;
}

function renderPrimaryTabs() {
  const active = currentShellTab();
  for (const tab of document.querySelectorAll('#primary-tabs .primary-tab')) {
    const on = tab.dataset.shellTab === active;
    tab.classList.toggle('active', on);
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function setRailPinned(pinned, { persist = true } = {}) {
  const rail = $('#workspace-rail');
  const button = $('#workspace-rail-pin');
  if (!rail || !button) return;
  rail.dataset.pinned = pinned ? 'true' : 'false';
  delete rail.dataset.hoverSuppressed;
  button.setAttribute('aria-pressed', String(pinned));
  button.title = pinned ? 'Unpin workspace rail' : 'Pin workspace rail';
  button.setAttribute('aria-label', button.title);
  if (persist) localStorage.setItem(STORAGE_KEYS.workspaceRail, pinned ? 'pinned' : 'rail');
  requestAnimationFrame(refreshGridWidth);
  setTimeout(refreshGridWidth, 220);
}

function renderTabs() {
  const { workspaces, activeWorkspaceId } = store.dashboard;
  const multi = workspaces.length > 1;
  $('#ws-tabs').innerHTML = workspaces
    .map((w) => {
      const active = store.view === 'board' && w.id === activeWorkspaceId;
      const style = w.textColor ? ` style="color:${esc(w.textColor)};--ws-color:${esc(w.textColor)}"` : '';
      const initial = (w.name || '?').trim().charAt(0).toUpperCase() || '?';
      return `<button type="button" class="ws-tab${active ? ' active' : ''}" data-ws="${esc(w.id)}" draggable="true" title="Drag to reorder · double-click to rename"${style}>
        <span class="ws-initial" aria-hidden="true">${esc(initial)}</span>
        <span class="ws-name">${esc(w.name)}</span>
        <span class="ws-style" title="Tab text colour">🎨</span>
        ${multi ? '<span class="ws-x" title="Delete workspace">✕</span>' : ''}
      </button>`;
    })
    .join('') + '<button type="button" class="ws-add" title="New workspace">＋</button>';

  // Mobile mirror: a native dropdown (CSS swaps it in for the tab row).
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  $('#ws-select').style.color = store.view === 'board' && activeWs?.textColor ? activeWs.textColor : '';
  $('#ws-select').innerHTML = workspaces
    .map((w) => {
      const selected = store.view === 'board' && w.id === activeWorkspaceId;
      const optionStyle = w.textColor ? ` style="color:${esc(w.textColor)}"` : '';
      return `<option value="${esc(w.id)}"${selected ? ' selected' : ''}${optionStyle}>${esc(w.name)}</option>`;
    })
    .join('') + '<option value="__add__">＋ New workspace…</option>';
}

async function addWorkspace() {
  const values = await openDialog({ title: 'New workspace', fields: [{ name: 'name', placeholder: 'Name' }], submitLabel: 'Create' });
  if (!values?.name) return;
  try {
    const ws = await api('/api/workspaces', jsonBody({ name: values.name }));
    setView('board');
    localStorage.setItem(STORAGE_KEYS.view, 'board');
    await switchWorkspace(ws.id);
  } catch (err) {
    toast(`Could not add workspace: ${err.message}`, { error: true });
  }
}

async function renameWorkspace(id) {
  const w = store.dashboard.workspaces.find((x) => x.id === id);
  const values = await openDialog({ title: 'Rename workspace', fields: [{ name: 'name', value: w?.name || '' }], submitLabel: 'Rename' });
  if (!values?.name || values.name === w?.name) return;
  try {
    await api(`/api/workspaces/${id}`, jsonBody({ name: values.name }, 'PATCH'));
    await loadDashboard();
  } catch (err) {
    toast(`Could not rename: ${err.message}`, { error: true });
  }
}

function styleWorkspace(id, anchor) {
  const w = store.dashboard.workspaces.find((x) => x.id === id);
  if (!w) return;
  openPalette({
    anchor,
    title: `Workspace: ${w.name}`,
    rows: [{ label: 'Text', prop: 'textColor', colors: WORKSPACE_TAB_TEXT_COLORS, current: w.textColor }],
    onSwatch: ({ color }) => {
      w.textColor = color;
      const tab = anchor.closest('.ws-tab');
      tab?.style.setProperty('color', color || '');
      if (color) tab?.style.setProperty('--ws-color', color);
      else tab?.style.removeProperty('--ws-color');
      if (w.id === store.dashboard.activeWorkspaceId) $('#ws-select').style.color = color || '';
      api(`/api/workspaces/${id}`, jsonBody({ textColor: color }, 'PATCH'))
        .catch((err) => toast(`Could not save tab colour: ${err.message}`, { error: true }));
    },
  });
}

async function deleteWorkspace(id) {
  try {
    await api(`/api/workspaces/${id}`, { method: 'DELETE' });
    await loadDashboard();
    toast('Workspace deleted', { action: 'Undo', onAction: async () => { await api('/api/undo', { method: 'POST' }); await loadDashboard(); } });
  } catch (err) {
    toast(err.message, { error: true }); // backend refuses non-empty / last workspace
  }
}

function clearDropMarks() {
  for (const tab of $('#ws-tabs').querySelectorAll('.ws-tab')) tab.classList.remove('dragging', 'drop-before', 'drop-after');
}

function dropPosition(tab, e) {
  const rect = tab.getBoundingClientRect();
  if (tab.closest('.workspace-rail')) return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

function finalDropIndex(targetId, side) {
  const ids = store.dashboard.workspaces.map((w) => w.id);
  const sourceIndex = ids.indexOf(draggingWs);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return -1;
  const raw = targetIndex + (side === 'after' ? 1 : 0);
  return raw > sourceIndex ? raw - 1 : raw;
}

async function moveWorkspaceTab(id, position) {
  try {
    const dashboard = await api(`/api/workspaces/${id}/move`, jsonBody({ position }));
    applyDashboard(dashboard);
  } catch (err) {
    toast(`Could not move workspace: ${err.message}`, { error: true });
    await loadDashboard().catch(() => {});
  }
}

export function initWorkspaces() {
  setRailPinned(localStorage.getItem(STORAGE_KEYS.workspaceRail) === 'pinned', { persist: false });

  const rail = $('#workspace-rail');
  $('#workspace-rail-pin')?.addEventListener('click', () => {
    setRailPinned(rail?.dataset.pinned !== 'true');
  });

  $('#primary-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.primary-tab');
    if (!tab) return;
    const id = tab.dataset.shellTab;
    if (id === 'search') return;
    if (id === 'dashboard') { showBoardWorkspace(store.dashboard.activeWorkspaceId); return; }
    if (id === 'chat') {
      showBoardWorkspace(store.dashboard.activeWorkspaceId, { shellTab: 'chat' });
      openDock({ focus: true });
      return;
    }
    if (id === 'models') { showView('models'); return; }
    if (id === 'teach') showView('prompts');
  });

  const tabs = $('#ws-tabs');
  tabs.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    if (e.target.closest('.ws-add')) return addWorkspace();
    const tab = e.target.closest('.ws-tab');
    if (!tab) return;
    const style = e.target.closest('.ws-style');
    if (style) return styleWorkspace(tab.dataset.ws, style);
    if (e.target.closest('.ws-x')) return deleteWorkspace(tab.dataset.ws);
    showBoardWorkspace(tab.dataset.ws);
  });
  tabs.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.ws-tab');
    if (tab) renameWorkspace(tab.dataset.ws);
  });
  tabs.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.ws-tab');
    if (!tab || e.target.closest('.ws-x, .ws-style')) { e.preventDefault(); return; }
    draggingWs = tab.dataset.ws;
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingWs);
  });
  tabs.addEventListener('dragover', (e) => {
    if (!draggingWs) return;
    const tab = e.target.closest('.ws-tab');
    if (!tab || tab.dataset.ws === draggingWs) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    tab.classList.add(dropPosition(tab, e) === 'before' ? 'drop-before' : 'drop-after');
  });
  tabs.addEventListener('dragleave', (e) => {
    if (!tabs.contains(e.relatedTarget)) clearDropMarks();
  });
  tabs.addEventListener('drop', async (e) => {
    const tab = e.target.closest('.ws-tab');
    if (!draggingWs || !tab || tab.dataset.ws === draggingWs) return;
    e.preventDefault();
    const position = finalDropIndex(tab.dataset.ws, dropPosition(tab, e));
    const id = draggingWs;
    draggingWs = null;
    clearDropMarks();
    suppressClickUntil = Date.now() + 250;
    if (position >= 0) await moveWorkspaceTab(id, position);
  });
  tabs.addEventListener('dragend', () => {
    draggingWs = null;
    clearDropMarks();
  });

  // Mobile dropdown: switch workspace, or fall to the New-workspace dialog.
  $('#ws-select').addEventListener('change', (e) => {
    if (e.target.value === '__add__') { renderTabs(); return addWorkspace(); } // reset selection, then prompt
    showBoardWorkspace(e.target.value);
  });

  // ⋯ menu: system view entries.
  $('#overflow-menu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-view]');
    if (!item) return;
    showView(item.dataset.view);
  });

  subscribe('dashboard', () => { renderTabs(); applyPanels(); renderPrimaryTabs(); });
  subscribe('view', () => { renderTabs(); applyPanels(); renderPrimaryTabs(); });

  const saved = localStorage.getItem(STORAGE_KEYS.view);
  if (saved && saved !== 'board' && systemViews.has(saved)) showView(saved);
}
