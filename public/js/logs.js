// In-UI conversation log viewer (topbar 🧾 Logs dropdown). Glance at recent
// turns; use `npm run logs` for deep/SQL queries.
import { $, api, esc, fmtMs } from './util.js';

const menu = $('#logs-menu');
const KIND = { chat: '💬', validate: '🧪', redteam: '🛡️' };
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

async function loadLogs() {
  try {
    const rows = await api('/api/logs?limit=40');
    if (!rows.length) {
      menu.innerHTML = '<div class="mr-empty">No conversations logged yet.</div>';
      return;
    }
    menu.innerHTML =
      `<div class="mr-head">${rows.length} recent turns · <code>npm run logs</code> for more</div>` +
      rows
        .map((r) => {
          const verdict = r.kind !== 'chat' && r.pass !== null ? (r.pass ? ' ✓' : ' ✗') : '';
          const meta = `${esc(r.model || '?')}${r.kind !== 'chat' ? ` · ${esc(r.task || '')}${verdict}` : ''}${r.ms ? ` · ${fmtMs(r.ms)}` : ''}`;
          const tools = (r.trace || []).length
            ? `<div class="lg-tools">${r.trace.map((t) => `<span class="tchip ${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'} ${esc(t.name)}</span>`).join('')}</div>`
            : '';
          const body = r.error
            ? `<div class="mr-fail">✗ ${esc(trunc(r.error, 160))}</div>`
            : r.reply ? `<div class="lg-reply">${esc(trunc(r.reply, 160))}</div>` : '';
          return `<div class="lg-item ${r.error ? 'bad' : 'ok'}">
            <div class="lg-head"><span>${KIND[r.kind] || '·'} ${meta}</span><span class="lg-ts">${esc((r.ts || '').slice(11, 16))}</span></div>
            <div class="lg-user">${esc(trunc(r.user_msg, 160))}</div>
            ${body}${tools}
          </div>`;
        })
        .join('');
  } catch {
    menu.innerHTML = '<div class="mr-empty">offline</div>';
  }
}

$('#logs-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelectorAll('.topbar .dropdown-menu').forEach((m) => { if (m.id !== 'logs-menu') m.classList.add('hidden'); });
  const opening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden');
  if (opening) loadLogs();
});
document.addEventListener('click', (e) => {
  if (!menu.classList.contains('hidden') && !e.target.closest('.dropdown')) menu.classList.add('hidden');
});
