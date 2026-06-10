// Abilities view: the tools the copilot can call — the ONLY ways a model can
// change the dashboard.
import { $, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

export async function renderAbilitiesView() {
  const panel = $('#view-abilities');
  try {
    const tools = await api('/api/abilities');
    panel.innerHTML =
      `<div class="sys-summary">${tools.length} agent abilities — the only ways the copilot can change the dashboard</div>` +
      '<div class="ab-grid">' +
      tools
        .map(
          (t) => `<div class="ab-card">
            <div class="ab-name">${esc(t.name)}</div>
            <div class="ab-desc">${esc(t.description)}</div>
            ${t.params.length ? `<div class="ab-params">${t.params.map((p) => `<span class="ab-param${t.required.includes(p) ? ' req' : ''}">${esc(p)}</span>`).join('')}</div>` : ''}
          </div>`
        )
        .join('') +
      '</div>';
  } catch {
    panel.innerHTML = '<div class="sys-summary">Abilities are offline.</div>';
  }
}
