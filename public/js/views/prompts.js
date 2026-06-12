// Prompts view: review and edit the prompts sent to the models. Edits apply
// on the next model call; saving the default text restores "default".
import { $, esc, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';

function card(p) {
  const lines = p.template.split('\n').length;
  return `<div class="pr-card" data-id="${esc(p.id)}">
    <div class="pr-head">
      <span class="pr-name">${esc(p.name)}</span>
      <span class="pr-badge ${p.isDefault ? '' : 'edited'}">${p.isDefault ? 'default' : 'edited'}</span>
    </div>
    <div class="pr-desc">${esc(p.description)}</div>
    ${p.warning ? `<div class="pr-warn">⚠️ ${esc(p.warning)}</div>` : ''}
    <div class="pr-vars">Filled per request: ${p.placeholders.map((h) => `<code>${esc(h)}</code>`).join(' ')}</div>
    <textarea class="pr-edit" rows="${Math.min(24, lines + 1)}" spellcheck="false">${esc(p.template)}</textarea>
    <div class="pr-actions">
      <button type="button" class="primary-btn pr-save">Save</button>
      <button type="button" class="ghost-btn pr-reset"${p.isDefault ? ' disabled' : ''}>Reset to default</button>
    </div>
  </div>`;
}

function wire(el, p) {
  const edit = el.querySelector('.pr-edit');
  const badge = el.querySelector('.pr-badge');
  const reset = el.querySelector('.pr-reset');
  const save = async (template) => {
    try {
      const out = await api(`/api/prompts/${p.id}`, jsonBody({ template }, 'PUT'));
      edit.value = out.template;
      badge.textContent = out.isDefault ? 'default' : 'edited';
      badge.classList.toggle('edited', !out.isDefault);
      reset.disabled = out.isDefault;
      toast(out.isDefault ? `${p.name} back to default` : `${p.name} saved — applies on the next model call`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  el.querySelector('.pr-save').addEventListener('click', () => save(edit.value));
  reset.addEventListener('click', () => save(''));
}

export async function renderPromptsView() {
  const panel = $('#view-prompts');
  try {
    const prompts = await api('/api/prompts');
    panel.innerHTML =
      '<div class="sys-summary">Model prompts — edits apply on the next call, no restart. Placeholders are filled live; keep them where the text needs them.</div>'
      + `<div class="pr-list">${prompts.map(card).join('')}</div>`;
    for (const el of panel.querySelectorAll('.pr-card')) {
      wire(el, prompts.find((p) => p.id === el.dataset.id));
    }
  } catch {
    panel.innerHTML = '<div class="sys-summary">Prompts are offline.</div>';
  }
}
