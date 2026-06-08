// Shared frontend helpers: DOM, fetch, escaping, markdown, formatting.
export const $ = (sel) => document.querySelector(sel);

export async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const jsonBody = (obj, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export const NOTE_COLORS = ['#f6d365', '#a0e7a0', '#9bd0ff', '#ffb3c1', '#e0c3fc'];

export function fmtMs(ms) {
  if (!ms) return '';
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function speedTier(ms) {
  if (!ms) return '';
  if (ms < 2500) return '⚡';
  if (ms < 6000) return '🟢';
  if (ms < 12000) return '🟡';
  return '🐢';
}

// Minimal, safe markdown → HTML for assistant replies. HTML is escaped FIRST,
// then a limited set of safe transforms are applied, so model output can't
// inject markup. Links are restricted to http(s).
export function mdToHtml(src) {
  let s = esc(src);
  const blocks = [];
  const inline = [];
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n+$/, '')}</code></pre>`);
    return ` B${blocks.length - 1} `;
  });
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { inline.push(`<code>${c}</code>`); return ` I${inline.length - 1} `; });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/(?:^|\n)((?:[-*]\s+.+(?:\n|$))+)/g, (_, blk) => {
    const items = blk.trim().split('\n').map((l) => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<br>\s*(<\/?(?:ul|pre|li)>)/g, '$1').replace(/(<\/?(?:ul|pre|li)>)\s*<br>/g, '$1');
  s = s.replace(/ I(\d+) /g, (_, i) => inline[+i]);
  s = s.replace(/ B(\d+) /g, (_, i) => blocks[+i]);
  return s;
}
