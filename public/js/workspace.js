// Workspaces: the tab bar above the board. CONTENT workspaces come from the
// dashboard state (each is its own board of sections + notes); SYSTEM
// workspaces (e.g. Models) are registered by a feature module and have their
// own panel. The board panel is shared — switching content workspaces just
// re-filters it (grid.js renders only the active workspace's cards).
import { $, api, jsonBody, esc } from './util.js';
import { STORAGE_KEYS } from './constants.js';
import { state, onRender, switchWorkspace, loadDashboard } from './store.js';

const systemWorkspaces = []; // { id, label, onActivate }
// What's on screen: 'board' (a content workspace) or a system workspace id.
let viewing = localStorage.getItem(STORAGE_KEYS.activeView) || 'board';

export function registerSystemWorkspace(ws) {
  systemWorkspaces.push(ws);
}

function persistView() {
  localStorage.setItem(STORAGE_KEYS.activeView, viewing);
}

function applyPanels() {
  const onBoard = viewing === 'board';
  $('#ws-dashboard').classList.toggle('hidden', !onBoard);
  for (const w of systemWorkspaces) document.getElementById(`ws-${w.id}`)?.classList.toggle('hidden', viewing !== w.id);
  document.body.dataset.ws = onBoard ? 'dashboard' : viewing;
}

function renderTabs() {
  const multi = state.workspaces.length > 1;
  const content = state.workspaces
    .map((w) => {
      const active = viewing === 'board' && w.id === state.activeWorkspaceId;
      return `<button type="button" class="ws-tab${active ? ' active' : ''}" data-ws="${esc(w.id)}" data-kind="content">
        <span class="ws-name">${esc(w.name)}</span>
        ${multi ? '<span class="ws-x" title="Delete workspace">✕</span>' : ''}
      </button>`;
    })
    .join('');
  const add = '<button type="button" class="ws-add" title="New workspace">＋</button>';
  const sys = systemWorkspaces
    .map((w) => `<button type="button" class="ws-tab ws-system${viewing === w.id ? ' active' : ''}" data-ws="${esc(w.id)}" data-kind="system">${typeof w.label === 'function' ? w.label() : w.label}</button>`)
    .join('');
  $('#ws-tabs').innerHTML = content + add + sys;
}

// onRender subscriber: rebuild tabs + reconcile which panel is shown. If the
// workspace we were viewing vanished (deleted), fall back to the board.
function refresh() {
  if (viewing !== 'board' && !systemWorkspaces.some((w) => w.id === viewing)) viewing = 'board';
  renderTabs();
  applyPanels();
}

function showSystem(id) {
  viewing = id;
  persistView();
  refresh();
  systemWorkspaces.find((w) => w.id === id)?.onActivate?.();
}

function showContent(id) {
  viewing = 'board';
  persistView();
  if (id && id !== state.activeWorkspaceId) switchWorkspace(id); // setState → refresh via onRender
  else refresh();
}

// Show the board for a given workspace (used by global search to jump to a find).
export async function showBoardWorkspace(id) {
  viewing = 'board';
  persistView();
  if (id && id !== state.activeWorkspaceId) await switchWorkspace(id);
  else refresh();
}

async function addWorkspace() {
  const name = prompt('New workspace name:');
  if (!name || !name.trim()) return;
  try {
    const ws = await api('/api/workspaces', jsonBody({ name: name.trim() }));
    viewing = 'board';
    persistView();
    await switchWorkspace(ws.id); // create + jump to it
  } catch (err) {
    alert('Could not add workspace: ' + err.message);
  }
}

async function renameWorkspace(id) {
  const w = state.workspaces.find((x) => x.id === id);
  const name = prompt('Rename workspace:', w?.name || '');
  if (!name || !name.trim() || name === w?.name) return;
  try {
    await api(`/api/workspaces/${id}`, jsonBody({ name: name.trim() }, 'PATCH'));
    await loadDashboard();
  } catch (err) {
    alert('Could not rename: ' + err.message);
  }
}

async function deleteWorkspace(id) {
  const w = state.workspaces.find((x) => x.id === id);
  if (!confirm(`Delete workspace "${w?.name}"? It must be empty.`)) return;
  try {
    await api(`/api/workspaces/${id}`, { method: 'DELETE' });
    if (viewing === 'board' && state.activeWorkspaceId === id) viewing = 'board';
    await loadDashboard();
  } catch (err) {
    alert(err.message); // backend refuses non-empty / last workspace
  }
}

export function initWorkspaces() {
  const tabs = $('#ws-tabs');
  tabs.addEventListener('click', (e) => {
    if (e.target.closest('.ws-add')) return addWorkspace();
    const tab = e.target.closest('.ws-tab');
    if (!tab) return;
    if (e.target.closest('.ws-x')) return deleteWorkspace(tab.dataset.ws);
    if (tab.dataset.kind === 'system') showSystem(tab.dataset.ws);
    else showContent(tab.dataset.ws);
  });
  tabs.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.ws-tab[data-kind="content"]');
    if (tab) renameWorkspace(tab.dataset.ws);
  });
  onRender(refresh);
  refresh();
  // If we restored onto a system workspace (e.g. Models), populate its panel.
  systemWorkspaces.find((w) => w.id === viewing)?.onActivate?.();
}
