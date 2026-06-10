// Colour palette: opens anchored to the 🎨 button, but can be dragged out of
// the way by its header — a slack cable keeps it tied to the card it styles.
// The cable is honest physics-flavoured fun: it sags when the palette sits
// close, pulls taut when dragged far, and wobbles on a small spring while
// moving. It also carries meaning: hovering a swatch tints the cable, and
// picking one sends the colour flowing down the wire to the card.
import { h } from '../lib/dom.js';
import { NOTE_TRANSPARENT_COLOR } from '../constants.js';
import { subscribe } from '../state/store.js';
import { pushEscLayer } from '../keys.js';

const MARGIN = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CABLE = {
  restLength: 260, // virtual cable length: closer than this and it sags
  maxSag: 56,
  minSag: 5,
  minDraw: 8, // hide the cable when the palette overlaps its anchor
  springK: 0.16,
  springDamping: 0.72,
  flowMs: 700,
};

let pop = null;
let tether = null;
let cleanup = null;
let dragged = false;
let dragState = null;
let rafId = 0;
// Spring state for the cable's control point (gives it the trailing wobble).
const ctrl = { x: 0, y: 0, vx: 0, vy: 0, seeded: false };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

function clampPos(left, top) {
  return {
    left: Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - pop.offsetWidth - MARGIN)),
    top: Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - pop.offsetHeight - MARGIN)),
  };
}

function ensureTether() {
  tether = document.createElementNS(SVG_NS, 'svg');
  tether.setAttribute('class', 'palette-tether');
  tether.setAttribute('aria-hidden', 'true');
  tether.innerHTML = `
    <path class="palette-tether-shadow"></path>
    <path class="palette-tether-line"></path>
    <circle class="palette-tether-dot start" r="3"></circle>
    <circle class="palette-tether-ring end" r="5"></circle>`;
  document.body.append(tether);
}

// Tint the cable (hover preview); default/transparent fall back to the accent.
function tintTether(color) {
  if (!tether) return;
  if (color && color !== NOTE_TRANSPARENT_COLOR) tether.style.setProperty('--tether-color', color);
  else tether.style.removeProperty('--tether-color');
}

// A picked colour flows down the wire to the card.
function flowTether(color) {
  if (!tether) return;
  tintTether(color);
  tether.classList.remove('flow');
  void tether.getBoundingClientRect(); // restart the dash animation
  tether.classList.add('flow');
  setTimeout(() => tether?.classList.remove('flow'), CABLE.flowMs);
}

// One animation frame: follow the anchor (until dragged), then draw the
// cable from the palette edge to the anchor with sag + spring.
function frame(anchor) {
  if (!pop) return;
  if (!document.contains(anchor)) return closePalette();

  const a = anchor.getBoundingClientRect();
  const end = { x: a.left + a.width / 2, y: a.top + a.height / 2 };

  if (!dragged && !dragState) {
    // Glued next to its anchor until the user pulls it away.
    let left = Math.min(a.right - pop.offsetWidth + 24, window.innerWidth - pop.offsetWidth - MARGIN);
    left = Math.max(MARGIN, left);
    let top = a.bottom + 10;
    if (top + pop.offsetHeight > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - pop.offsetHeight - 10);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  const p = pop.getBoundingClientRect();
  const start = {
    x: Math.min(Math.max(end.x, p.left), p.right),
    y: Math.min(Math.max(end.y, p.top), p.bottom),
  };
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const visible = dist >= CABLE.minDraw;
  tether.classList.toggle('hidden', !visible);

  if (visible) {
    // Slack cable: the shorter the span, the deeper the downward sag.
    const slack = Math.max(0, CABLE.restLength - dist);
    const sag = Math.min(CABLE.maxSag, CABLE.minSag + slack * 0.24);
    const target = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + sag };

    if (!ctrl.seeded || reduceMotion.matches) {
      ctrl.x = target.x;
      ctrl.y = target.y;
      ctrl.vx = 0;
      ctrl.vy = 0;
      ctrl.seeded = true;
    } else {
      ctrl.vx = (ctrl.vx + (target.x - ctrl.x) * CABLE.springK) * CABLE.springDamping;
      ctrl.vy = (ctrl.vy + (target.y - ctrl.y) * CABLE.springK) * CABLE.springDamping;
      ctrl.x += ctrl.vx;
      ctrl.y += ctrl.vy;
    }

    tether.classList.toggle('taut', dist > CABLE.restLength);
    const d = `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`;
    for (const path of tether.querySelectorAll('path')) path.setAttribute('d', d);
    const dotS = tether.querySelector('.start');
    dotS.setAttribute('cx', start.x);
    dotS.setAttribute('cy', start.y);
    const dotE = tether.querySelector('.end');
    dotE.setAttribute('cx', end.x);
    dotE.setAttribute('cy', end.y);
  }

  rafId = requestAnimationFrame(() => frame(anchor));
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
          flowTether(color);
          onSwatch({ prop: row.prop, color });
        },
        onmouseenter: () => tintTether(color),
        onmouseleave: () => tintTether(''),
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
  const head = h('div', { class: 'palette-head', title: 'Drag me out of the way — the string stays tied to the card' },
    h('span', { class: 'palette-grip' }, '⠿'),
    h('span', { class: 'palette-origin' }, title),
    closeBtn);
  pop = h('div', { class: 'palette-popover' }, head, body);
  document.body.append(pop);
  ensureTether();

  // Drag by the header; once dragged it stops following the anchor.
  const onMove = (e) => {
    if (!dragState) return;
    e.preventDefault();
    const pos = clampPos(dragState.left + (e.clientX - dragState.x), dragState.top + (e.clientY - dragState.y));
    pop.style.left = `${pos.left}px`;
    pop.style.top = `${pos.top}px`;
  };
  const onUp = () => {
    if (!dragState) return;
    dragState = null;
    pop.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.palette-close')) return;
    const r = pop.getBoundingClientRect();
    dragState = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    dragged = true;
    pop.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) closePalette(); };
  const popEsc = pushEscLayer(() => closePalette());
  const unsubRender = subscribe('board-rendered', () => closePalette());
  setTimeout(() => document.addEventListener('pointerdown', onOutside));

  cleanup = () => {
    cancelAnimationFrame(rafId);
    popEsc();
    unsubRender();
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    pop?.remove();
    tether?.remove();
    pop = null;
    tether = null;
    dragged = false;
    dragState = null;
    ctrl.seeded = false;
    cleanup = null;
  };

  frame(anchor);
}
