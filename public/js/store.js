// Shared dashboard state + render orchestration. Feature modules register a
// renderer via onRender(); loadDashboard()/setState() refresh state and notify
// them. `state` is a live binding, so importers always read the current value.
import { $, api } from './util.js';

export let state = { title: 'Dashboard', sections: [], notes: [], featureRequests: [] };

const renderers = [];
export function onRender(fn) {
  renderers.push(fn);
}

export function render() {
  $('#title').textContent = state.title;
  document.title = `${state.title} · Dashboard`;
  for (const fn of renderers) fn();
}

export function setState(next) {
  state = next;
  render();
}

export async function loadDashboard() {
  setState(await api('/api/dashboard'));
}
