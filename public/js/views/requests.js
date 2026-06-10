// Requests view: the feature-request queue the copilot files into when asked
// for something it can't do.
import { $, esc } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { FEATURE_REQUEST_STATUSES } from '../constants.js';
import { store, subscribe, loadDashboard } from '../state/store.js';

export function renderRequestsView() {
  const list = $('#fr-list');
  const frs = store.dashboard.featureRequests;
  const open = frs.filter((f) => f.status === 'open').length;
  const badge = $('#fr-count');
  badge.textContent = open ? String(open) : '';
  badge.classList.toggle('hidden', !open);

  if (!frs.length) {
    list.innerHTML = '<p class="fr-empty">No requests yet. Ask Dashy for something it can\'t do — it\'ll file one here.</p>';
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
  for (const el of list.querySelectorAll('.fr')) {
    const id = el.dataset.id;
    el.querySelector('select').addEventListener('change', (e) =>
      api(`/api/feature-requests/${id}`, jsonBody({ status: e.target.value }, 'PATCH')).then(loadDashboard));
    el.querySelector('.del').addEventListener('click', () =>
      api(`/api/feature-requests/${id}`, { method: 'DELETE' }).then(loadDashboard));
  }
}

export function initRequests() {
  $('#fr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#fr-title').value.trim();
    if (!title) return;
    await api('/api/feature-requests', jsonBody({ title, detail: $('#fr-detail').value.trim(), requestedBy: 'you' }));
    $('#fr-title').value = '';
    $('#fr-detail').value = '';
    await loadDashboard();
  });
  subscribe('dashboard', renderRequestsView);
}
