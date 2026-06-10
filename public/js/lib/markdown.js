// Minimal, safe markdown → HTML for copilot replies. HTML is escaped FIRST,
// then a limited set of safe transforms are applied, so model output can't
// inject markup. Links are restricted to http(s).
import { esc } from './dom.js';

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
