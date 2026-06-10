// The live step timeline for an agent run, and the post-run revert bar.
import { h, toast, flashElement } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { store, subscribe, applyDashboard } from '../state/store.js';

function flashCard(ids = []) {
  for (const id of ids) {
    const safe = CSS.escape(id);
    const item = document.querySelector(`#board [gs-id="${safe}"] .card, #board .tile-chip[data-id="${safe}"]`);
    if (item) { flashElement(item); return; }
  }
}

// A per-run timeline appended above the reply bubble. Steps appear as the
// server reports them: spinner while running, ✓/✗ + summary when finished.
export function createStepTimeline(container) {
  const el = h('div', { class: 'steps' });
  const rows = new Map();
  return {
    start(i, name, ids) {
      if (!el.isConnected) container.append(el);
      const row = h('div', { class: 'step running' },
        h('span', { class: 'step-status' }, '◌'),
        h('span', { class: 'step-name' }, name),
        h('span', { class: 'step-sub' }, ''));
      if (ids?.length) {
        row.classList.add('clickable');
        row.title = 'Show on the board';
        row.addEventListener('click', () => flashCard(ids));
      }
      rows.set(i, row);
      el.append(row);
      el.scrollIntoView({ block: 'nearest' });
    },
    finish(i, { ok, summary, error, ids }) {
      const row = rows.get(i);
      if (!row) return;
      row.classList.remove('running');
      row.classList.add(ok ? 'ok' : 'bad');
      row.querySelector('.step-status').textContent = ok ? '✓' : '✗';
      row.querySelector('.step-sub').textContent = ok ? (summary || '') : (error || 'failed');
      if (ids?.length && !row.classList.contains('clickable')) {
        row.classList.add('clickable');
        row.addEventListener('click', () => flashCard(ids));
      }
    },
    count() { return rows.size; },
  };
}

// "N changes applied · Revert this run" — counts back the run's commits via
// /api/undo-batch, guarded by the revision so it can never eat later edits.
// The button greys out the moment anything else changes the board.
export function showRunBar(container, { revBefore, revAfter }) {
  const steps = revAfter - revBefore;
  if (steps < 1) return;
  const btn = h('button', { type: 'button' }, 'Revert this run');
  const bar = h('div', { class: 'run-bar' },
    h('span', {}, `✦ ${steps} change${steps === 1 ? '' : 's'} applied`),
    h('span', { class: 'spacer' }),
    btn);
  container.append(bar);

  const stale = () => {
    btn.disabled = true;
    btn.title = 'The board has changed since this run';
  };
  const unsub = subscribe('dashboard', () => {
    if (store.rev !== revAfter) { stale(); unsub(); }
  });
  if (store.rev !== revAfter) stale();
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await api('/api/undo-batch', jsonBody({ steps, expectedRev: revAfter }));
      unsub();
      applyDashboard(res.dashboard, res.rev);
      bar.replaceChildren(h('span', {}, '↶ Run reverted (redo restores it)'));
      toast('Run reverted');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}
