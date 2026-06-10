// Workspace tabs + view switching. Content workspaces come from the dashboard
// state; system views (Models / Abilities / Requests / Logs) live behind the
// ⋯ menu and register an onActivate refresher here.
import { $, esc, toast } from './lib/dom.js';
import { api, jsonBody } from './lib/api.js';
import { openDialog } from './lib/dialog.js';
import { STORAGE_KEYS } from './constants.js';
import { store, subscribe, setView, switchWorkspace, loadDashboard } from './state/store.js';

const systemViews = new Map(); // id -> onActivate

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
      return `<button type="button" class="ws-tab${active ? ' active' : ''}" data-ws="${esc(w.id)}" title="Double-click to rename">
        <span class="ws-name">${esc(w.name)}</span>
        ${multi ? '<span class="ws-x" title="Delete workspace">✕</span>' : ''}
      </button>`;
    })
    .join('') + '<button type="button" class="ws-add" title="New workspace">＋</button>';
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

export function initWorkspaces() {
  const tabs = $('#ws-tabs');
  tabs.addEventListener('click', (e) => {
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
