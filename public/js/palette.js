import { esc } from './util.js';

const TRANSPARENT = 'transparent';
let popover;
let tether;
let currentAnchor;
let dragged = false;
let dragState;

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
  tether = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tether.classList.add('palette-tether', 'hidden');
  tether.setAttribute('aria-hidden', 'true');
  tether.innerHTML = `
    <path class="palette-tether-shadow"></path>
    <path class="palette-tether-line"></path>
    <circle class="palette-tether-dot start" r="3"></circle>
    <circle class="palette-tether-dot end" r="3"></circle>`;
  document.body.appendChild(tether);
  document.body.appendChild(popover);
  popover.addEventListener('click', (e) => e.stopPropagation());
  return popover;
}

function clampPosition(left, top) {
  const margin = 12;
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

function updateTether() {
  if (!tether || !popover || popover.classList.contains('hidden')) return;
  if (!currentAnchor?.isConnected) {
    closePalette();
    return;
  }
  const anchor = currentAnchor.getBoundingClientRect();
  const palette = popover.getBoundingClientRect();
  const start = { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };
  const end = {
    x: Math.min(Math.max(start.x, palette.left), palette.right),
    y: Math.min(Math.max(start.y, palette.top), palette.bottom),
  };
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  tether.classList.toggle('hidden', length < 8);
  if (length < 8) return;
  const bend = Math.min(34, length * 0.18);
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  const control = {
    x: (start.x + end.x) / 2 + normal.x * bend,
    y: (start.y + end.y) / 2 + normal.y * bend,
  };
  const d = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
  tether.querySelectorAll('path').forEach((path) => path.setAttribute('d', d));
  tether.querySelector('.start').setAttribute('cx', start.x);
  tether.querySelector('.start').setAttribute('cy', start.y);
  tether.querySelector('.end').setAttribute('cx', end.x);
  tether.querySelector('.end').setAttribute('cy', end.y);
}

function positionPopover(anchor) {
  if (!popover || !anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  let left = rect.right + 8;
  if (left + width > window.innerWidth - 12) left = rect.left - width - 8;
  const pos = clampPosition(left, rect.top);
  popover.style.left = `${pos.left}px`;
  popover.style.top = `${pos.top}px`;
  updateTether();
}

function movePopover(left, top) {
  const pos = clampPosition(left, top);
  popover.style.left = `${pos.left}px`;
  popover.style.top = `${pos.top}px`;
  updateTether();
}

function syncPosition() {
  if (!currentAnchor) return;
  if (dragged) {
    const rect = popover.getBoundingClientRect();
    movePopover(rect.left, rect.top);
  } else {
    positionPopover(currentAnchor);
  }
}

export function closePalette() {
  if (!popover) return;
  popover.classList.add('hidden');
  tether?.classList.add('hidden');
  currentAnchor = null;
  dragState = null;
  dragged = false;
  popover.classList.remove('dragging');
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
}

function onMove(e) {
  if (!dragState) return;
  e.preventDefault();
  movePopover(dragState.left + (e.clientX - dragState.x), dragState.top + (e.clientY - dragState.y));
}

function onUp() {
  if (!dragState) return;
  popover?.classList.remove('dragging');
  dragState = null;
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
}

export function openPalette({ anchor, title, rows, toggles = [], onSwatch, onToggle }) {
  const el = ensurePopover();
  currentAnchor = anchor;
  dragged = false;
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
  el.querySelector('.palette-head').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.palette-close')) return;
    const rect = el.getBoundingClientRect();
    dragState = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    dragged = true;
    el.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
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
window.addEventListener('resize', syncPosition);
window.addEventListener('scroll', () => { if (currentAnchor) updateTether(); }, true);
