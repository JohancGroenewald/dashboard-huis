// Attachment chips: board items pinned as context for the next prompt (the
// per-card ✦ menus dispatch 'attach-item'; folded into the prompt as exact
// ids on send), plus pasted screenshots that ride to vision models as base64.
import { $, esc } from '../lib/dom.js';

const attachments = []; // { type, id, label } | { type:'image', id, label, b64, thumb }

export function renderAttachments() {
  const box = $('#dock-attachments');
  box.classList.toggle('hidden', attachments.length === 0);
  box.innerHTML = attachments
    .map((a, i) => {
      const x = `<button type="button" class="attach-x" data-i="${i}">✕</button>`;
      return a.type === 'image'
        ? `<span class="attach-chip image"><img src="${a.thumb}" alt="" />${esc(a.label)}${x}</span>`
        : `<span class="attach-chip">✦ ${esc(a.type)}: ${esc(a.label)}${x}</span>`;
    })
    .join('');
  for (const b of box.querySelectorAll('.attach-x')) {
    b.addEventListener('click', () => { attachments.splice(Number(b.dataset.i), 1); renderAttachments(); });
  }
}

export function addAttachment(item) {
  if (!attachments.some((x) => x.id === item.id)) attachments.push(item);
  renderAttachments();
}

// A pasted image file becomes a chip with a thumbnail; the base64 payload is
// attached to the next user message for the model to look at.
export function addImageAttachment(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const thumb = String(reader.result);
    attachments.push({
      type: 'image',
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      label: file.name || 'screenshot',
      b64: thumb.split(',')[1] || '',
      thumb,
    });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

export const hasImageAttachments = () => attachments.some((a) => a.type === 'image');

// Prefix the prompt with exact ids so the model acts on the referenced items
// without guessing, split off the image payloads, then clear the chips.
export function consumeAttachments(text) {
  const images = attachments.filter((a) => a.type === 'image');
  const items = attachments.filter((a) => a.type !== 'image');
  const prefix = items.map((a) => `[${a.type} "${a.label}" id:${a.id}]`).join(' ');
  attachments.length = 0;
  renderAttachments();
  return {
    text: prefix ? `${prefix}\n${text}` : text,
    images: images.map((a) => a.b64),
    thumbs: images.map((a) => a.thumb),
  };
}
