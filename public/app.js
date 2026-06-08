// Entry point: importing each feature module wires its DOM events and registers
// its renderer; then we do the initial loads and start the refresh intervals.
import { $ } from './js/util.js';
import { loadDashboard } from './js/store.js';
import { loadHealth } from './js/grid.js';
import './js/fr.js';
import './js/logs.js';
import { loadModels } from './js/chat.js';
import { loadModelsReport } from './js/models.js';
import { registerSystemWorkspace, initWorkspaces } from './js/workspace.js';

function tick() {
  $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// Content workspaces come from the dashboard state (rendered by workspace.js).
// Models is a SYSTEM workspace: its own panel, re-fetched each time it's opened.
registerSystemWorkspace({ id: 'models', label: '🧪 Models', onActivate: loadModelsReport });
initWorkspaces();

loadDashboard();
loadModels();
loadHealth();
tick();
setInterval(tick, 30_000);
setInterval(loadHealth, 30_000);
