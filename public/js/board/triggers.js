// Trigger cards: a named button that stamps the time when pressed, then
// shows a live countdown until the cooldown lets it be pressed again. The
// server is the authority on presses; a 1s ticker only repaints countdowns.
import { $$, esc, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { TRIGGER_COOLDOWNS } from '../constants.js';
import { loadDashboard } from '../state/store.js';
import { inlineEdit, deleteWithUndo } from './editor.js';

function fmtRemaining(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const readyAt = (t) => (t.lastPressedAt ? Date.parse(t.lastPressedAt) + t.cooldownMs : 0);

const fmtStamp = (iso) =>
  new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function cooldownOptions(t) {
  const opts = TRIGGER_COOLDOWNS.map(({ label, ms }) =>
    `<option value="${ms}"${t.cooldownMs === ms ? ' selected' : ''}>${esc(label)}</option>`);
  if (!TRIGGER_COOLDOWNS.some(({ ms }) => ms === t.cooldownMs)) {
    opts.unshift(`<option value="${t.cooldownMs}" selected>${esc(fmtRemaining(t.cooldownMs))}</option>`);
  }
  return opts.join('');
}

const running = new Set(); // trigger ids with a press in flight — locks the card

// History as a table: when each press happened + the gap since the previous
// one (newest first, so the gap is to the older row beneath it).
function historyTable(history) {
  const rows = history.map((iso, i) => {
    const older = history[i + 1];
    const gap = older ? fmtRemaining(Date.parse(iso) - Date.parse(older)) : '—';
    return `<tr><td>${esc(fmtStamp(iso))}</td><td class="trigger-gap">${esc(gap)}</td></tr>`;
  }).join('');
  return `<table class="trigger-hist-tbl">
    <thead><tr><th>When</th><th class="trigger-gap">Since prev.</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function triggerInner(t) {
  const cooling = readyAt(t) > Date.now();
  const busy = running.has(t.id);
  return `<div class="card trigger-card${busy ? ' running' : ''}" data-id="${t.id}" data-ready-at="${readyAt(t)}">
    <div class="sec-head trigger-head">
      <span class="card-grip" title="Drag trigger">⠿</span>
      <span class="trigger-name" title="Click to rename">${esc(t.name)}</span>
      <button class="ctl danger trigger-del" type="button" title="Delete trigger">✕</button>
    </div>
    <button type="button" class="trigger-press${cooling ? ' cooling' : ''}"${cooling || busy ? ' disabled' : ''}>
      ${busy ? '⏳ …' : cooling ? `⏳ <span class="trigger-count">${fmtRemaining(readyAt(t) - Date.now())}</span>` : '⏱ Press'}
    </button>
    <div class="trigger-sub">${t.lastPressedAt ? `last: ${esc(fmtStamp(t.lastPressedAt))}` : 'never pressed'}</div>
    <select class="trigger-cooldown" title="${cooling ? 'Locked while cooling down' : 'How long before it can be pressed again'}"${busy || cooling ? ' disabled' : ''}>${cooldownOptions(t)}</select>
    ${t.history.length > 1 ? `<details class="trigger-hist"><summary>🕐 history</summary>${historyTable(t.history)}</details>` : ''}
  </div>`;
}

// Lock/unlock a card's controls instantly (before the next board re-render).
function setBusy(el, on) {
  const card = el.querySelector('.trigger-card');
  if (!card) return;
  card.classList.toggle('running', on);
  const press = card.querySelector('.trigger-press');
  press.disabled = on || press.classList.contains('cooling');
  if (on) press.innerHTML = '⏳ …';
  card.querySelector('.trigger-cooldown').disabled = on;
}

export function wireTrigger(el, t) {
  const nameEl = el.querySelector('.trigger-name');
  nameEl.addEventListener('click', () => inlineEdit(nameEl, {
    value: t.name,
    onSubmit: (name) => api(`/api/triggers/${t.id}`, jsonBody({ name }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.trigger-press').addEventListener('click', async () => {
    if (running.has(t.id)) return;
    running.add(t.id);
    setBusy(el, true); // whole card locks while the press is in flight
    try {
      await api(`/api/triggers/${t.id}/press`, { method: 'POST' });
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      running.delete(t.id);
      await loadDashboard(); // rebuilds the card from authoritative state
    }
  });
  el.querySelector('.trigger-cooldown').addEventListener('change', async (e) => {
    try {
      await api(`/api/triggers/${t.id}`, jsonBody({ cooldownMs: Number(e.target.value) }, 'PATCH'));
    } catch (err) {
      toast(err.message, { error: true });
    }
    await loadDashboard();
  });
  el.querySelector('.trigger-del').addEventListener('click', () => deleteWithUndo(`/api/triggers/${t.id}`, `Deleted trigger "${t.name}"`));
}

// One ticker repaints every cooling card's countdown; when a cooldown ends it
// re-enables the button in place — no board rebuild.
setInterval(() => {
  for (const card of $$('#board .trigger-card[data-ready-at]')) {
    if (card.classList.contains('running')) continue; // a press is in flight; leave it locked
    const ready = Number(card.dataset.readyAt);
    if (!ready) continue;
    const btn = card.querySelector('.trigger-press');
    const left = ready - Date.now();
    if (left > 0) {
      const count = card.querySelector('.trigger-count');
      if (count) count.textContent = fmtRemaining(left);
    } else if (btn.disabled) {
      btn.disabled = false;
      btn.classList.remove('cooling');
      btn.innerHTML = '⏱ Press';
      card.dataset.readyAt = '0';
      // Cooldown's over: the period dropdown becomes editable again.
      const sel = card.querySelector('.trigger-cooldown');
      sel.disabled = false;
      sel.title = 'How long before it can be pressed again';
    }
  }
}, 1000);
