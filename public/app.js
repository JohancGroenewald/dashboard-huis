// Entry point: importing each feature module wires its DOM events and registers
// its renderer; then we do the initial loads and start the refresh intervals.
import { $ } from './js/util.js';
import { REFRESH_INTERVALS } from './js/constants.js';
import { loadDashboard, state } from './js/store.js';
import { loadHealth } from './js/grid.js';
import { renderFR } from './js/fr.js';
import './js/logs.js';
import './js/search.js';
import { loadModels } from './js/chat.js';
import { loadModelsReport } from './js/models.js';
import { loadAbilities } from './js/abilities.js';
import { registerSystemWorkspace, initWorkspaces } from './js/workspace.js';

function tick() {
  $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// Content workspaces come from the dashboard state (rendered by workspace.js).
// Models + Abilities are SYSTEM workspaces: their own panels, re-fetched on open.
registerSystemWorkspace({ id: 'models', label: '🧪 Models', onActivate: loadModelsReport });
registerSystemWorkspace({ id: 'abilities', label: '🛠️ Abilities', onActivate: loadAbilities });
registerSystemWorkspace({
  id: 'requests',
  label: () => {
    const open = state.featureRequests.filter((f) => f.status === 'open').length;
    return open ? `🗒️ Requests (${open})` : '🗒️ Requests';
  },
  onActivate: renderFR,
});
initWorkspaces();

loadDashboard();
loadModels();
loadHealth();
tick();
setInterval(tick, REFRESH_INTERVALS.clockMs);
setInterval(loadHealth, REFRESH_INTERVALS.healthMs);
