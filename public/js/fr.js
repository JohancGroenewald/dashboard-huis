// Feature-request queue — its own workspace (🗒️ Requests tab).
import { $, api, jsonBody, esc } from './util.js';
import { FEATURE_REQUEST_STATUSES } from './constants.js';
import { state, onRender, loadDashboard } from './store.js';

export function renderFR() {
  const list = $('#fr-list');
  if (!list) return;
  const frs = state.featureRequests;
  if (!frs.length) {
    list.innerHTML = '<p class="empty">No requests yet. Ask the assistant for something it can\'t do — it\'ll file one here.</p>';
    return;
  }
  list.innerHTML = frs
    .map((fr) => {
      const opts = FEATURE_REQUEST_STATUSES.map((s) => `<option value="${s}"${s === fr.status ? ' selected' : ''}>${s}</option>`).join('');
      return `<div class="fr ${fr.status}" data-id="${fr.id}">
        <div class="fr-title">${esc(fr.title)}</div>
        ${fr.detail ? `<div class="fr-detail">${esc(fr.detail)}</div>` : ''}
        <div class="fr-meta"><span class="fr-by">by ${esc(fr.requestedBy)}</span><select>${opts}</select><button class="del" title="Delete">🗑</button></div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('.fr').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('select').addEventListener('change', (e) => api(`/api/feature-requests/${id}`, jsonBody({ status: e.target.value }, 'PATCH')).then(loadDashboard));
    el.querySelector('.del').addEventListener('click', () => api(`/api/feature-requests/${id}`, { method: 'DELETE' }).then(loadDashboard));
  });
}

onRender(renderFR);
$('#fr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#fr-title').value.trim();
  if (!title) return;
  await api('/api/feature-requests', jsonBody({ title, detail: $('#fr-detail').value.trim(), requestedBy: 'you' }));
  $('#fr-title').value = '';
  $('#fr-detail').value = '';
  await loadDashboard();
});
