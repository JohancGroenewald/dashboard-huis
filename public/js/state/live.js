// Live updates: consume /api/events so every open browser tracks the board,
// and translate activity into pulses on the affected cards.
//
// Two pulse kinds: 'ai' (violet — the copilot did it) and 'remote' (blue —
// another tab/user did it). Agent events name their target ids; for plain
// dashboard broadcasts we diff old vs new state client-side.
import { clientId } from '../lib/api.js';
import { listenEvents } from '../lib/sse.js';
import { PULSE_UI } from '../constants.js';
import { store, subscribe, publish, applyDashboard, loadDashboard } from './store.js';

const touched = new Map(); // id -> { until, kind }
const pendingIds = new Set(); // a tool call is running against these

function cardEl(id) {
  const safe = CSS.escape(id);
  const item = document.querySelector(`#board [gs-id="${safe}"], #board .tile-chip[data-id="${safe}"]`);
  if (!item) return null;
  return item.classList.contains('tile-chip') ? item : (item.querySelector('.card, .note-ghost') || null);
}

function applyPulse(id, kind) {
  const el = cardEl(id);
  if (!el) return;
  const cls = kind === 'ai' ? 'ai-touched' : 'remote-pulse';
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation when re-applied
  el.classList.add(cls);
  if (kind === 'ai' && !el.querySelector('.ai-badge')) {
    const b = document.createElement('span');
    b.className = 'ai-badge';
    b.textContent = '✦ changed';
    el.append(b);
    setTimeout(() => b.remove(), PULSE_UI.badgeMs);
  }
  setTimeout(() => el.classList.remove(cls), PULSE_UI.flashMs);
}

export function markTouched(ids, kind = 'ai') {
  const until = Date.now() + PULSE_UI.flashMs;
  for (const id of ids || []) {
    touched.set(id, { until, kind });
    applyPulse(id, kind);
  }
}

function setPending(ids, on) {
  for (const id of ids || []) {
    if (on) pendingIds.add(id);
    else pendingIds.delete(id);
    cardEl(id)?.classList.toggle('ai-pending', on);
  }
}

// The board rebuilds from scratch on every state change; re-apply any pulse
// or pending marker that hasn't expired to the fresh elements.
function redecorate() {
  const now = Date.now();
  for (const [id, t] of touched) {
    if (t.until < now) touched.delete(id);
    else applyPulse(id, t.kind);
  }
  for (const id of pendingIds) cardEl(id)?.classList.add('ai-pending');
}

function indexCards(d) {
  const m = new Map();
  for (const s of d.sections) m.set(s.id, JSON.stringify(s));
  for (const n of d.notes) m.set(n.id, JSON.stringify(n));
  return m;
}

// Ids of cards that are new or different between two dashboard trees.
function changedIds(prev, next) {
  const before = indexCards(prev);
  const after = indexCards(next);
  const ids = [];
  for (const [id, json] of after) if (before.get(id) !== json) ids.push(id);
  return ids;
}

export function initLive() {
  subscribe('board-rendered', redecorate);

  let dropped = false;
  listenEvents({
    onDrop: () => { dropped = true; },
    events: {
      hello: (h) => {
        // (Re)connected: refetch if we missed anything while away.
        if (dropped || h.rev > store.rev) loadDashboard();
        dropped = false;
      },
      dashboard: (d) => {
        const remote = d.sourceClient !== clientId;
        const ids = remote ? changedIds(store.dashboard, d.dashboard) : [];
        const applied = applyDashboard(d.dashboard, d.rev, { viewOnly: Boolean(d.viewOnly) });
        if (!applied || !remote) return;
        // Agent-driven changes already pulse violet via agent events; only
        // pulse blue for ids the agent didn't claim.
        markTouched(ids.filter((id) => touched.get(id)?.kind !== 'ai' && !pendingIds.has(id)), 'remote');
      },
      agent: (a) => {
        publish('agent', a);
        if (a.phase === 'tool-start') setPending(a.ids, true);
        else if (a.phase === 'tool-result') {
          setPending(a.ids, false);
          if (a.ok) markTouched(a.ids, 'ai');
        } else if (a.phase === 'done') setPending([...pendingIds], false);
      },
    },
  });
}
