// v2 entry point: wire the modules, do the initial loads, start the timers.
import { $, toast } from './lib/dom.js';
import { api } from './lib/api.js';
import { REFRESH_INTERVALS } from './constants.js';
import { store, subscribe, loadDashboard, setHealth, setInteractionCheck, applyDashboard } from './state/store.js';
import { setKeyHandler } from './keys.js';
import { initWorkspaces, registerView } from './workspaces.js';
import { initBoard, isInteracting } from './board/board.js';
import { initLive } from './state/live.js';
import { renderModelsView } from './views/models.js';
import { renderAbilitiesView } from './views/abilities.js';
import { renderRequestsView, initRequests } from './views/requests.js';
import { renderLogsView } from './views/logs.js';

function tick() {
  $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

async function loadHealth() {
  try { setHealth(await api('/api/health')); } catch { /* offline */ }
}

// ---- undo / redo ----
async function history(path) {
  try {
    const { dashboard, canUndo, canRedo } = await api(path, { method: 'POST' });
    applyDashboard(dashboard);
    $('#undo-btn').disabled = !canUndo;
    $('#redo-btn').disabled = !canRedo;
  } catch (err) {
    toast(err.message, { error: true });
  }
}

// ---- system views ----
registerView('models', renderModelsView);
registerView('abilities', renderAbilitiesView);
registerView('requests', renderRequestsView);
registerView('logs', renderLogsView);

// ---- shell wiring ----
subscribe('dashboard', () => {
  $('#title').textContent = store.dashboard.title;
  document.title = `${store.dashboard.title} · Dashboard`;
});

const overflowMenu = $('#overflow-menu');
$('#menu-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  overflowMenu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) overflowMenu.classList.add('hidden');
});

$('#undo-btn').addEventListener('click', () => history('/api/undo'));
$('#redo-btn').addEventListener('click', () => history('/api/redo'));
setKeyHandler('undo', () => history('/api/undo'));
setKeyHandler('redo', () => history('/api/redo'));

// Placeholders until their milestones land: ⌘K (M5), the copilot dock (M4b).
const comingSoon = (what) => () => toast(`${what} arrives in a later milestone — the old UI at / still has the assistant.`);
$('#cmdk-pill').addEventListener('click', comingSoon('⌘K'));
$('#dock-expand').addEventListener('click', comingSoon('The copilot dock'));
setKeyHandler('cmdk', comingSoon('⌘K'));

// ---- boot ----
setInteractionCheck(isInteracting);
initBoard();
initWorkspaces();
initRequests();
initLive();
loadDashboard();
loadHealth();
tick();
setInterval(tick, REFRESH_INTERVALS.clockMs);
setInterval(loadHealth, REFRESH_INTERVALS.healthMs);
