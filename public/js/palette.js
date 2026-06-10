import { esc } from './util.js';

const TRANSPARENT = 'transparent';
let popover;
let currentAnchor;

function swatchRow({ label, prop, colors, current }) {
  const swatches = colors.map((c) => {
    const sel = (current || '') === c ? ' sel' : '';
    if (c === TRANSPARENT) {
      return `<span class="sty-swatch transparent${sel}" data-prop="${esc(prop)}" data-color="${c}" title="Transparent"></span>`;
    }
    return c
      ? `<span class="sty-swatch${sel}" data-prop="${esc(prop)}" data-color="${esc(c)}" style="background:${esc(c)}" title="${esc(c)}"></span>`
      : `<span class="sty-swatch clear${sel}" data-prop="${esc(prop)}" data-color="" title="Default"></span>`;
  }).join('');
  return `<div class="sty-row"><span class="sty-label">${esc(label)}</span><span class="sty-swatches">${swatches}</span></div>`;
}

function ensurePopover() {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.className = 'palette-popover hidden';
  document.body.appendChild(popover);
  popover.addEventListener('click', (e) => e.stopPropagation());
  return popover;
}

function positionPopover(anchor) {
  if (!popover || !anchor?.isConnected) return;
  const margin = 12;
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = rect.right + 8;
  if (left + width > window.innerWidth - margin) left = rect.left - width - 8;
  left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  const top = Math.min(Math.max(margin, rect.top), maxTop);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

export function closePalette() {
  if (!popover) return;
  popover.classList.add('hidden');
  currentAnchor = null;
}

export function openPalette({ anchor, title, rows, toggles = [], onSwatch, onToggle }) {
  const el = ensurePopover();
  currentAnchor = anchor;
  const toggleHtml = toggles.map((t) =>
    `<label class="sty-toggle"><input type="checkbox" data-prop="${esc(t.prop)}"${t.checked ? ' checked' : ''}> ${esc(t.label)}</label>`
  ).join('');
  el.innerHTML = `
    <div class="palette-head">
      <span class="palette-origin" title="${esc(title)}">${esc(title)}</span>
      <button class="palette-close" type="button" title="Close">✕</button>
    </div>
    <div class="palette-body">${rows.map(swatchRow).join('')}${toggleHtml}</div>`;
  el.classList.remove('hidden');
  el.querySelector('.palette-close').addEventListener('click', closePalette);
  el.querySelectorAll('.sty-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      const row = sw.closest('.sty-row');
      row.querySelectorAll('.sty-swatch').forEach((s) => s.classList.toggle('sel', s === sw));
      onSwatch?.({ prop: sw.dataset.prop, color: sw.dataset.color || '' });
    });
  });
  el.querySelectorAll('.sty-toggle input').forEach((input) => {
    input.addEventListener('change', () => onToggle?.({ prop: input.dataset.prop, checked: input.checked }));
  });
  requestAnimationFrame(() => positionPopover(anchor));
}

document.addEventListener('click', closePalette);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePalette(); });
window.addEventListener('resize', () => { if (currentAnchor) positionPopover(currentAnchor); });
window.addEventListener('scroll', () => { if (currentAnchor) positionPopover(currentAnchor); }, true);
