// Workspace math-art backgrounds. Dashy can set a constrained effect spec on a
// workspace; the browser renders it on a full-viewport canvas behind the board.
// No model-authored JavaScript is executed here.
import { $ } from '../lib/dom.js';
import { WORKSPACE_BACKGROUND_EFFECTS } from '../constants.js';
import { store, subscribe } from '../state/store.js';

const DEFAULT_PALETTE = ['#4c8dff', '#69d28a', '#a371f7', '#f0b429'];
const canvas = $('#workspace-bg');
const ctx = canvas.getContext('2d');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let raf = 0;
let started = 0;
let currentKey = '';

const clamp = (n, min, max) => Math.min(Math.max(Number(n) || 0, min), max);
const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function activeBackground() {
  const ws = store.dashboard.workspaces.find((w) => w.id === store.dashboard.activeWorkspaceId);
  return ws?.background || { effect: WORKSPACE_BACKGROUND_EFFECTS.none };
}

function colors(bg) {
  return (Array.isArray(bg.palette) && bg.palette.length ? bg.palette : DEFAULT_PALETTE).slice(0, 6);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(window.innerWidth * dpr));
  const h = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width === w && canvas.height === h) return dpr;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  return dpr;
}

function backdrop(bg) {
  const p = colors(bg);
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, p[0]);
  grad.addColorStop(0.55, p[1] || p[0]);
  grad.addColorStop(1, p[2] || p[0]);
  ctx.globalAlpha = 0.18 * clamp(bg.intensity ?? 1, 0, 5);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

function drawWaves(bg, t) {
  const p = colors(bg);
  const density = 6 + clamp(bg.density ?? 1, 0, 5) * 5;
  const amp = canvas.height * (0.025 + clamp(bg.intensity ?? 1, 0, 5) * 0.012);
  ctx.lineWidth = Math.max(1, canvas.width / 1200);
  for (let i = 0; i < density; i++) {
    const y0 = (i + 0.5) * canvas.height / density;
    ctx.beginPath();
    ctx.strokeStyle = p[i % p.length];
    ctx.globalAlpha = 0.22;
    for (let x = 0; x <= canvas.width; x += 18) {
      const y = y0
        + Math.sin(x * 0.006 + t + i * 0.7) * amp
        + Math.sin(x * 0.013 - t * 0.8 + i) * amp * 0.45;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawOrbits(bg, t) {
  const p = colors(bg);
  const count = 5 + Math.round(clamp(bg.density ?? 1, 0, 5) * 4);
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.52;
  ctx.lineWidth = Math.max(1, canvas.width / 1500);
  for (let i = 0; i < count; i++) {
    const r = Math.min(canvas.width, canvas.height) * (0.12 + i * 0.036);
    const a = t * (0.22 + i * 0.025);
    ctx.strokeStyle = p[i % p.length];
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * (1.6 - i * 0.02), r, a, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = p[(i + 1) % p.length];
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r, 3 + i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlasma(bg, t) {
  const p = colors(bg);
  const step = Math.max(10, 34 - clamp(bg.density ?? 1, 0, 5) * 4);
  const scale = 0.006 + clamp(bg.density ?? 1, 0, 5) * 0.0015;
  ctx.globalAlpha = 0.18 + clamp(bg.intensity ?? 1, 0, 5) * 0.04;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const v = Math.sin(x * scale + t) + Math.sin(y * scale - t * 0.7) + Math.sin((x + y) * scale * 0.6 + t * 0.5);
      ctx.fillStyle = p[Math.abs(Math.floor((v + 3) * p.length / 6)) % p.length];
      ctx.fillRect(x, y, step + 1, step + 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawStars(bg, t) {
  const p = colors(bg);
  const count = 80 + Math.round(clamp(bg.density ?? 1, 0, 5) * 90);
  const drift = t * 12;
  for (let i = 0; i < count; i++) {
    const x = hash(i + 1) * canvas.width;
    const y = (hash(i + 101) * canvas.height + drift * (0.25 + hash(i + 201))) % canvas.height;
    const r = 0.6 + hash(i + 301) * 2.2;
    ctx.globalAlpha = Math.min(1, (0.12 + hash(i + 401) * 0.55) * clamp(bg.intensity ?? 1, 0, 5));
    ctx.fillStyle = p[i % p.length];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paint(now = performance.now()) {
  const bg = activeBackground();
  const speed = clamp(bg.speed ?? 1, 0, 5);
  resize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  backdrop(bg);
  const t = reduceMotion.matches ? 0 : ((now - started) / 1000) * speed;
  if (bg.effect === WORKSPACE_BACKGROUND_EFFECTS.waves) drawWaves(bg, t);
  else if (bg.effect === WORKSPACE_BACKGROUND_EFFECTS.orbits) drawOrbits(bg, t);
  else if (bg.effect === WORKSPACE_BACKGROUND_EFFECTS.plasma) drawPlasma(bg, t);
  else if (bg.effect === WORKSPACE_BACKGROUND_EFFECTS.stars) drawStars(bg, t);
  if (!reduceMotion.matches) raf = requestAnimationFrame(paint);
}

function refresh() {
  cancelAnimationFrame(raf);
  raf = 0;
  const bg = activeBackground();
  const active = store.view === 'board' && bg.effect && bg.effect !== WORKSPACE_BACKGROUND_EFFECTS.none;
  canvas.classList.toggle('active', Boolean(active));
  if (!active) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentKey = '';
    return;
  }
  const key = JSON.stringify({ bg, view: store.view, ws: store.dashboard.activeWorkspaceId });
  if (key !== currentKey) {
    currentKey = key;
    started = performance.now();
  }
  paint();
}

export function initWorkspaceBackground() {
  subscribe('dashboard', refresh);
  subscribe('view', refresh);
  window.addEventListener('resize', refresh);
  reduceMotion.addEventListener('change', refresh);
  refresh();
}
