// Abilities workspace: the tools the assistant can call, shown as cards. These
// are the ONLY ways a model can change the dashboard. Re-fetched each time the
// workspace is opened.
import { $, api, esc } from './util.js';

export async function loadAbilities() {
  const panel = $('#ws-abilities');
  if (!panel) return;
  try {
    const tools = await api('/api/abilities');
    panel.innerHTML =
      `<div class="mw-summary">${tools.length} agent abilities — the only ways the assistant can change the dashboard</div>` +
      `<div class="ab-grid">` +
      tools
        .map(
          (t) => `<div class="ab-card">
            <div class="ab-name">${esc(t.name)}</div>
            <div class="ab-desc">${esc(t.description)}</div>
            ${t.params.length ? `<div class="ab-params">${t.params.map((p) => `<span class="ab-param${t.required.includes(p) ? ' req' : ''}">${esc(p)}</span>`).join('')}</div>` : ''}
          </div>`
        )
        .join('') +
      `</div>`;
  } catch {
    panel.innerHTML = '<div class="mw-summary">Abilities are offline.</div>';
  }
}
