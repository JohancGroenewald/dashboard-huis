// Colour palette: a popover anchored to the 🎨 button that opened it. It
// follows its anchor (flipping above when out of room) and closes on Esc,
// outside click, or board re-render — the old tether/drag machinery is gone
// because the popover now stays put next to its anchor.
import { h } from '../lib/dom.js';
import { NOTE_TRANSPARENT_COLOR } from '../constants.js';
import { subscribe } from '../state/store.js';
import { pushEscLayer } from '../keys.js';

const MARGIN = 12;
let pop = null;
let cleanup = null;

export function closePalette() {
  cleanup?.();
}

function swatchClass(color, current) {
  const cls = ['sty-swatch'];
  if (!color) cls.push('clear');
  if (color === NOTE_TRANSPARENT_COLOR) cls.push('transparent');
  if ((color || '') === (current || '')) cls.push('sel');
  return cls.join(' ');
}

function position(anchor) {
  if (!pop || !document.contains(anchor)) return closePalette();
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const hgt = pop.offsetHeight;
  let left = Math.min(r.right - w + 24, window.innerWidth - w - MARGIN);
  left = Math.max(MARGIN, left);
  let top = r.bottom + 8;
  if (top + hgt > window.innerHeight - MARGIN) top = Math.max(MARGIN, r.top - hgt - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

export function openPalette({ anchor, title, rows, toggles = [], onSwatch, onToggle }) {
  closePalette();

  const body = h('div', { class: 'palette-body' });
  for (const row of rows) {
    const swatches = h('div', { class: 'sty-swatches' });
    for (const color of row.colors) {
      const b = h('button', {
        class: swatchClass(color, row.current),
        type: 'button',
        title: color || 'default',
        onclick: () => {
          row.current = color;
          for (const s of swatches.children) s.classList.remove('sel');
          swatches.children[row.colors.indexOf(color)].classList.add('sel');
          onSwatch({ prop: row.prop, color });
        },
      });
      if (color && color !== NOTE_TRANSPARENT_COLOR) b.style.background = color;
      swatches.append(b);
    }
    body.append(h('div', { class: 'sty-row' }, h('span', { class: 'sty-label' }, row.label), swatches));
  }
  for (const t of toggles) {
    const input = h('input', { type: 'checkbox' });
    input.checked = Boolean(t.checked);
    input.addEventListener('change', () => onToggle({ prop: t.prop, checked: input.checked }));
    body.append(h('label', { class: 'sty-toggle' }, input, t.label));
  }

  const closeBtn = h('button', { class: 'palette-close', type: 'button', title: 'Close', onclick: () => closePalette() }, '✕');
  pop = h('div', { class: 'palette-popover' },
    h('div', { class: 'palette-head' }, h('span', { class: 'palette-origin' }, title), closeBtn),
    body);
  document.body.append(pop);

  const reposition = () => position(anchor);
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) closePalette(); };
  const popEsc = pushEscLayer(() => closePalette());
  const unsubRender = subscribe('board-rendered', () => closePalette());
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  setTimeout(() => document.addEventListener('pointerdown', onOutside));

  cleanup = () => {
    popEsc();
    unsubRender();
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    document.removeEventListener('pointerdown', onOutside);
    pop?.remove();
    pop = null;
    cleanup = null;
  };

  position(anchor);
}
