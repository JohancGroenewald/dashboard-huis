// Workspaces: top-level tabs that switch the main content area. Each feature
// registers a workspace { id, label, onActivate? }; initWorkspaces() builds the
// tab bar and shows the saved (or first) workspace. The active id is mirrored on
// <body data-ws> so CSS can show/hide controls that only apply to one workspace.
import { $ } from './util.js';

const workspaces = [];

export function registerWorkspace(ws) {
  workspaces.push(ws);
}

export function activateWorkspace(id) {
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return;
  document.body.dataset.ws = id;
  for (const w of workspaces) {
    document.getElementById(`ws-${w.id}`)?.classList.toggle('hidden', w.id !== id);
  }
  $('#ws-tabs').querySelectorAll('.ws-tab').forEach((t) => t.classList.toggle('active', t.dataset.ws === id));
  localStorage.setItem('dash-ws', id);
  ws.onActivate?.();
}

export function initWorkspaces() {
  const tabs = $('#ws-tabs');
  tabs.innerHTML = workspaces
    .map((w) => `<button type="button" class="ws-tab" data-ws="${w.id}">${w.label}</button>`)
    .join('');
  tabs.querySelectorAll('.ws-tab').forEach((t) => t.addEventListener('click', () => activateWorkspace(t.dataset.ws)));
  const saved = localStorage.getItem('dash-ws');
  activateWorkspace(workspaces.some((w) => w.id === saved) ? saved : workspaces[0]?.id);
}
