// Problems view: the defect queue — things the copilot (or you) hit that
// failed. The sibling of the Requests view, which holds wishes instead.
import { $, esc } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { PROBLEM_STATUSES } from '../constants.js';
import { store, subscribe, loadDashboard } from '../state/store.js';

export function renderProblemsView() {
  const list = $('#pb-list');
  const problems = store.dashboard.problems || [];
  const open = problems.filter((p) => p.status === 'open').length;
  const badge = $('#pb-count');
  badge.textContent = open ? String(open) : '';
  badge.classList.toggle('hidden', !open);

  if (!problems.length) {
    list.innerHTML = '<p class="fr-empty">No problems reported. When Dashy hits an error it can\'t get past, it files one here.</p>';
    return;
  }
  list.innerHTML = problems
    .map((p) => {
      const opts = PROBLEM_STATUSES.map((s) => `<option value="${s}"${s === p.status ? ' selected' : ''}>${s}</option>`).join('');
      return `<div class="fr pb ${p.status}" data-id="${p.id}">
        <div class="fr-title">${esc(p.title)}</div>
        ${p.detail ? `<div class="fr-detail">${esc(p.detail)}</div>` : ''}
        <div class="fr-meta"><span class="fr-by">by ${esc(p.reportedBy)}</span><select>${opts}</select><button class="del" title="Delete">🗑</button></div>
      </div>`;
    })
    .join('');
  for (const el of list.querySelectorAll('.pb')) {
    const id = el.dataset.id;
    el.querySelector('select').addEventListener('change', (e) =>
      api(`/api/problems/${id}`, jsonBody({ status: e.target.value }, 'PATCH')).then(loadDashboard));
    el.querySelector('.del').addEventListener('click', () =>
      api(`/api/problems/${id}`, { method: 'DELETE' }).then(loadDashboard));
  }
}

export function initProblems() {
  $('#pb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#pb-title').value.trim();
    if (!title) return;
    await api('/api/problems', jsonBody({ title, detail: $('#pb-detail').value.trim(), reportedBy: 'you' }));
    $('#pb-title').value = '';
    $('#pb-detail').value = '';
    await loadDashboard();
  });
  subscribe('dashboard', renderProblemsView);
}
