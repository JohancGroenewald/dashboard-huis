// Logs view: recent agent conversations and validation runs.
import { $, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { fmtMs } from '../lib/format.js';
import { LOGS_UI } from '../constants.js';
import { replayRun } from './replay.js';

const KIND = { chat: '💬', validate: '🧪', redteam: '🛡️', game: '⭕', scrape: '⛏' };
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

export async function renderLogsView() {
  const panel = $('#view-logs');
  try {
    const rows = await api(`/api/logs?limit=${LOGS_UI.apiLimit}`);
    if (!rows.length) {
      panel.innerHTML = '<div class="sys-summary">No conversations logged yet.</div>';
      return;
    }
    panel.innerHTML =
      `<div class="sys-summary">${rows.length} recent turns · <code>npm run logs</code> for more</div>` +
      '<div class="lg-list">' +
      rows
        .map((r) => {
          const verdict = r.kind !== 'chat' && r.pass !== null ? (r.pass ? ' ✓' : ' ✗') : '';
          const meta = `${esc(r.model || '?')}${r.kind !== 'chat' ? ` · ${esc(r.task || '')}${verdict}` : ''}${r.ms ? ` · ${fmtMs(r.ms)}` : ''}`;
          const chips = (r.trace || []).map((t) => `<span class="tchip ${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'} ${esc(t.name)}</span>`).join('');
          const tools = chips ? `<div class="lg-tools">${chips}</div>` : '';
          const body = r.error
            ? `<div class="lg-fail">✗ ${esc(trunc(r.error, LOGS_UI.errorPreviewChars))}</div>`
            : r.reply ? `<div class="lg-reply">${esc(trunc(r.reply, LOGS_UI.replyPreviewChars))}</div>` : '';
          return `<div class="lg-item ${r.error ? 'bad' : 'ok'}">
            <div class="lg-head"><span>${KIND[r.kind] || '·'} ${meta}</span><span class="lg-ts">${esc((r.ts || '').slice(LOGS_UI.timestampStart, LOGS_UI.timestampEnd))}</span><button type="button" class="lg-replay" data-id="${r.id}" title="Play this run back">🎬</button></div>
            <div class="lg-user">${esc(trunc(r.user_msg, LOGS_UI.userPreviewChars))}</div>
            ${body}${tools}
          </div>`;
        })
        .join('') +
      '</div>';
    for (const b of panel.querySelectorAll('.lg-replay')) {
      b.addEventListener('click', () => replayRun(b.dataset.id));
    }
  } catch {
    panel.innerHTML = '<div class="sys-summary">Logs are offline.</div>';
  }
}
