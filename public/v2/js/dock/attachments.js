// Attachment chips: board items pinned as context for the next prompt. The
// per-card ✦ menus dispatch 'attach-item'; the chips render above the
// composer and are folded into the prompt as exact ids on send.
import { $, esc } from '../lib/dom.js';

const attachments = []; // { type, id, label }

export function renderAttachments() {
  const box = $('#dock-attachments');
  box.classList.toggle('hidden', attachments.length === 0);
  box.innerHTML = attachments
    .map((a, i) => `<span class="attach-chip">✦ ${esc(a.type)}: ${esc(a.label)}<button type="button" class="attach-x" data-i="${i}">✕</button></span>`)
    .join('');
  for (const b of box.querySelectorAll('.attach-x')) {
    b.addEventListener('click', () => { attachments.splice(Number(b.dataset.i), 1); renderAttachments(); });
  }
}

export function addAttachment(item) {
  if (!attachments.some((x) => x.id === item.id)) attachments.push(item);
  renderAttachments();
}

// Prefix the prompt with exact ids so the model acts on the referenced items
// without guessing, then clear the chips.
export function consumeAttachments(text) {
  if (!attachments.length) return text;
  const prefix = attachments.map((a) => `[${a.type} "${a.label}" id:${a.id}]`).join(' ');
  attachments.length = 0;
  renderAttachments();
  return `${prefix}\n${text}`;
}
