// Workspace tabs + view switching. Content workspaces come from the dashboard
// state; system views (Models / Abilities / Requests / Logs) live behind the
// ⋯ menu and register an onActivate refresher here.
import { $, esc, toast } from './lib/dom.js';
import { api, jsonBody } from './lib/api.js';
import { openDialog } from './lib/dialog.js';
import { STORAGE_KEYS } from './constants.js';
import { store, subscribe, setView, switchWorkspace, loadDashboard, applyDashboard } from './state/store.js';

const systemViews = new Map(); // id -> onActivate
let draggingWs = null;
let suppressClickUntil = 0;

export function registerView(id, onActivate) {
  systemViews.set(id, onActivate);
}

export function showView(id) {
  setView(id);
  localStorage.setItem(STORAGE_KEYS.view, id);
  systemViews.get(id)?.();
}

// Show the board, optionally jumping to another workspace (used by ⌘K).
export async function showBoardWorkspace(id) {
  setView('board');
  localStorage.setItem(STORAGE_KEYS.view, 'board');
  if (id && id !== store.dashboard.activeWorkspaceId) await switchWorkspace(id);
}

function applyPanels() {
  $('#view-board').classList.toggle('hidden', store.view !== 'board');
  for (const id of systemViews.keys()) $(`#view-${id}`)?.classList.toggle('hidden', store.view !== id);
}

function renderTabs() {
  const { workspaces, activeWorkspaceId } = store.dashboard;
  const multi = workspaces.length > 1;
  $('#ws-tabs').innerHTML = workspaces
    .map((w) => {
      const active = store.view === 'board' && w.id === activeWorkspaceId;
      return `<button type="button" class="ws-tab${active ? ' active' : ''}" data-ws="${esc(w.id)}" draggable="true" title="Drag to reorder · double-click to rename">
        <span class="ws-name">${esc(w.name)}</span>
        ${multi ? '<span class="ws-x" title="Delete workspace">✕</span>' : ''}
      </button>`;
    })
    .join('') + '<button type="button" class="ws-add" title="New workspace">＋</button>';

  // Mobile mirror: a native dropdown (CSS swaps it in for the tab row).
  $('#ws-select').innerHTML = workspaces
    .map((w) => `<option value="${esc(w.id)}"${store.view === 'board' && w.id === activeWorkspaceId ? ' selected' : ''}>${esc(w.name)}</option>`)
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

function dropPosition(tab, x) {
  const rect = tab.getBoundingClientRect();
  return x < rect.left + rect.width / 2 ? 'before' : 'after';
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
  const tabs = $('#ws-tabs');
  tabs.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    if (e.target.closest('.ws-add')) return addWorkspace();
    const tab = e.target.closest('.ws-tab');
    if (!tab) return;
    if (e.target.closest('.ws-x')) return deleteWorkspace(tab.dataset.ws);
    showBoardWorkspace(tab.dataset.ws);
  });
  tabs.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.ws-tab');
    if (tab) renameWorkspace(tab.dataset.ws);
  });
  tabs.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.ws-tab');
    if (!tab || e.target.closest('.ws-x')) { e.preventDefault(); return; }
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
    tab.classList.add(dropPosition(tab, e.clientX) === 'before' ? 'drop-before' : 'drop-after');
  });
  tabs.addEventListener('dragleave', (e) => {
    if (!tabs.contains(e.relatedTarget)) clearDropMarks();
  });
  tabs.addEventListener('drop', async (e) => {
    const tab = e.target.closest('.ws-tab');
    if (!draggingWs || !tab || tab.dataset.ws === draggingWs) return;
    e.preventDefault();
    const position = finalDropIndex(tab.dataset.ws, dropPosition(tab, e.clientX));
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
    $('#overflow-menu').classList.add('hidden');
    showView(item.dataset.view);
  });

  subscribe('dashboard', () => { renderTabs(); applyPanels(); });
  subscribe('view', () => { renderTabs(); applyPanels(); });

  const saved = localStorage.getItem(STORAGE_KEYS.view);
  if (saved && saved !== 'board' && systemViews.has(saved)) showView(saved);
}
