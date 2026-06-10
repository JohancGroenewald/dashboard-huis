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
import { routeCable, clampToEdge, edgeNormal, inflate, ptInside } from './cable-route.js';

const MARGIN = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CABLE = {
  restLength: 260, // virtual cable length: closer than this and it sags
  maxSag: 56,
  minSag: 5,
  routedSagMax: 18, // legs that hug the card keep the bow shallow
  minDraw: 8, // hide the cable when the palette overlaps its anchor
  springK: 0.16,
  springDamping: 0.72,
  flowMs: 700,
};
// The cable attaches to the outside edges of both boxes and routes around
// every card on the board (and the dock), not just its own card — see
// cable-route.js for the geometry.
const ROUTE = {
  pad: 14, // clearance the cable keeps from the boxes it dodges
  cornerRadius: 14,
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

// ---- cable drawing helpers ----
const moveToward = (from, to, by) => {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const t = Math.min(by, d / 2) / d;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
};

// Everything the cable should dodge: every board card plus the dock. Boxes
// that contain an endpoint can't be avoided, so they're dropped.
function collectObstacles(a, b) {
  const rects = [];
  for (const el of document.querySelectorAll('#board .grid-stack-item')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) rects.push(r);
  }
  const dock = document.querySelector('#dock');
  if (dock) rects.push(dock.getBoundingClientRect());
  return rects.filter((r) => !ptInside(a, inflate(r, ROUTE.pad)) && !ptInside(b, inflate(r, ROUTE.pad)));
}

// One animation frame: follow the anchor (until dragged), then run the cable
// edge-to-edge along the least-obstructed route, sag + spring on the first leg.
function frame(anchor) {
  if (!pop) return;
  if (!document.contains(anchor)) return closePalette();

  const a = anchor.getBoundingClientRect();

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
  const card = (anchor.closest('.card') || anchor).getBoundingClientRect();
  const cc = { x: (card.left + card.right) / 2, y: (card.top + card.bottom) / 2 };
  // Sockets sit on the outside edges of both boxes, facing each other.
  const end = clampToEdge({ x: (p.left + p.right) / 2, y: (p.top + p.bottom) / 2 }, card);
  const start = clampToEdge(cc, p);
  const visible = Math.hypot(end.x - start.x, end.y - start.y) >= CABLE.minDraw;
  tether.classList.toggle('hidden', !visible);

  if (visible) {
    // Route to a point just clear of the card's edge, then plug in
    // perpendicular to it.
    const n = edgeNormal(end, card);
    const target = { x: end.x + n.x * (ROUTE.pad + 1), y: end.y + n.y * (ROUTE.pad + 1) };
    const pts = [start, ...routeCable(start, target, collectObstacles(start, target), ROUTE.pad), end];

    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);

    // Sag the first leg: with gravity in open space, but pushed away from
    // the card (and kept shallow) when the route is dodging boxes.
    const routed = pts.length > 3; // more than [start, plug-point, socket]
    const leg = pts[1];
    const mid = { x: (start.x + leg.x) / 2, y: (start.y + leg.y) / 2 };
    const awayLen = Math.hypot(mid.x - cc.x, mid.y - cc.y) || 1;
    const away = { x: (mid.x - cc.x) / awayLen, y: (mid.y - cc.y) / awayLen };
    const slack = Math.max(0, CABLE.restLength - length);
    let sag = Math.min(CABLE.maxSag, CABLE.minSag + slack * 0.24);
    if (routed) sag = Math.min(sag, CABLE.routedSagMax);
    const ctrlTarget = (away.y > -0.2 && !routed)
      ? { x: mid.x + away.x * sag * 0.3, y: mid.y + sag } // gravity
      : { x: mid.x + away.x * sag, y: mid.y + away.y * sag }; // push clear of the boxes

    if (!ctrl.seeded || reduceMotion.matches) {
      ctrl.x = ctrlTarget.x;
      ctrl.y = ctrlTarget.y;
      ctrl.vx = 0;
      ctrl.vy = 0;
      ctrl.seeded = true;
    } else {
      ctrl.vx = (ctrl.vx + (ctrlTarget.x - ctrl.x) * CABLE.springK) * CABLE.springDamping;
      ctrl.vy = (ctrl.vy + (ctrlTarget.y - ctrl.y) * CABLE.springK) * CABLE.springDamping;
      ctrl.x += ctrl.vx;
      ctrl.y += ctrl.vy;
    }

    tether.classList.toggle('taut', length > CABLE.restLength);
    // First leg is the springy curve; detour legs take rounded turns; the
    // last hop plugs into the card's edge perpendicular to it.
    let d = `M ${start.x} ${start.y}`;
    for (let i = 1; i < pts.length; i++) {
      const last = i === pts.length - 1;
      const pt = pts[i];
      if (last) {
        d += i === 1 ? ` Q ${ctrl.x} ${ctrl.y} ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
      } else {
        const c1 = moveToward(pt, pts[i - 1], ROUTE.cornerRadius);
        const c2 = moveToward(pt, pts[i + 1], ROUTE.cornerRadius);
        d += i === 1 ? ` Q ${ctrl.x} ${ctrl.y} ${c1.x} ${c1.y}` : ` L ${c1.x} ${c1.y}`;
        d += ` Q ${pt.x} ${pt.y} ${c2.x} ${c2.y}`;
      }
    }
    d += ` L ${end.x} ${end.y}`;
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
