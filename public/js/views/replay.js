// Replay view: pick a logged run and watch it play back like a recording —
// the prompt appears, each tool call resolves one at a time, then the reply
// streams in. Transport controls (play/pause/restart/speed/scrubber) drive a
// deterministic frame timeline rebuilt from the stored trace + reply, so the
// scrubber can jump anywhere and the stage re-derives exactly.
import { $, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { mdToHtml } from '../lib/markdown.js';
import { fmtMs } from '../lib/format.js';
import { LOGS_UI } from '../constants.js';
import { store, subscribe } from '../state/store.js';
import { showView } from '../workspaces.js';

const KIND = { chat: '💬', validate: '🧪', redteam: '🛡️' };
// Per-frame display time at 1× (ms); the scheduler divides by the speed.
const DUR = { prompt: 600, toolStart: 480, toolDone: 320, reply: 55, end: 500 };
const SPEEDS = [1, 2, 4];

let rows = [];
let row = null;
let pendingId = null; // run to auto-select on the next load (set by replayRun)
let frames = [];
let idx = 0;
let playing = false;
let speed = 1;
let timer = null;

const countWords = (s) => (String(s).trim().match(/\S+/g) || []).length;
function sliceWords(s, n) {
  if (n <= 0) return '';
  const parts = String(s).split(/(\s+)/);
  let count = 0;
  const out = [];
  for (const p of parts) {
    out.push(p);
    if (/\S/.test(p) && ++count >= n) break;
  }
  return out.join('');
}

function stepSummary(e) {
  if (!e.ok) return e.error || 'failed';
  const r = e.result || {};
  const obj = r.added || r.updated || r.removed || r.moved || r.filed || r.activeWorkspace;
  const label = obj?.name || obj?.title || (obj?.text ? String(obj.text).slice(0, 40) : '');
  if (label) return `"${label}"`;
  const args = e.args && Object.keys(e.args).length ? JSON.stringify(e.args) : '';
  return args.length > 60 ? `${args.slice(0, 60)}…` : args;
}

// Flatten one run into an ordered list of frames.
function buildFrames(r) {
  const f = [{ kind: 'prompt' }];
  const trace = r.trace || [];
  trace.forEach((_, i) => { f.push({ kind: 'tool', i, phase: 'start' }); f.push({ kind: 'tool', i, phase: 'done' }); });
  const total = countWords(r.reply || '');
  if (total) {
    const stepN = Math.max(1, Math.round(total / 24)); // ~24 reply frames max
    for (let n = stepN; n < total; n += stepN) f.push({ kind: 'reply', upto: n });
    f.push({ kind: 'reply', upto: total });
  }
  f.push({ kind: 'end' });
  return f;
}

// Cumulative stage state after playing frames[0..idx].
function stateAt(i) {
  const st = { steps: new Map(), replyWords: 0, ended: false };
  for (let k = 0; k <= i && k < frames.length; k++) {
    const f = frames[k];
    if (f.kind === 'tool') {
      const s = st.steps.get(f.i) || { started: false, done: false };
      if (f.phase === 'start') s.started = true; else s.done = true;
      st.steps.set(f.i, s);
    } else if (f.kind === 'reply') st.replyWords = f.upto;
    else if (f.kind === 'end') st.ended = true;
  }
  return st;
}

function stepRow(e, i, state) {
  const s = state.steps.get(i);
  const status = !s?.started ? 'pending' : !s.done ? 'running' : (e.ok ? 'ok' : 'bad');
  const glyph = status === 'pending' ? '·' : status === 'running' ? '◌' : e.ok ? '✓' : '✗';
  const sub = s?.done ? stepSummary(e) : '';
  return `<div class="step ${status}">
    <span class="step-status">${glyph}</span>
    <span class="step-name">${esc(e.name || '?')}</span>
    <span class="step-sub">${esc(sub)}</span>
  </div>`;
}

function renderStage() {
  const stage = $('#rp-stage');
  if (!row) { stage.innerHTML = '<div class="rp-empty">Pick a run on the left to play it back.</div>'; return; }
  const st = stateAt(idx);
  const trace = row.trace || [];
  const verdict = row.kind !== 'chat' && row.pass !== null ? (row.pass ? '✓ pass' : '✗ fail') : '';
  const total = countWords(row.reply || '');
  const typing = st.replyWords > 0 && st.replyWords < total && !st.ended;
  const replyHtml = row.error
    ? `<div class="rp-error">⚠️ ${esc(row.error)}</div>`
    : st.ended || st.replyWords >= total
      ? mdToHtml(row.reply || '(no reply)')
      : (st.replyWords > 0 ? `${esc(sliceWords(row.reply, st.replyWords))}<span class="cursor"></span>` : '');

  stage.innerHTML = `
    <div class="rp-stage-head">
      <span class="rp-badge">${KIND[row.kind] || '·'} ${esc(row.model || '?')}</span>
      ${row.task ? `<span class="rp-chip">${esc(row.task)}</span>` : ''}
      ${verdict ? `<span class="rp-chip ${row.pass ? 'ok' : 'bad'}">${verdict}</span>` : ''}
      ${row.ms ? `<span class="rp-chip">${fmtMs(row.ms)}</span>` : ''}
      <span class="rp-chip">${trace.length} tool call${trace.length === 1 ? '' : 's'}</span>
    </div>
    <div class="rp-transcript">
      <div class="row user"><div class="bubble">${esc(row.user_msg || '(no prompt)')}</div></div>
      ${trace.length ? `<div class="steps">${trace.map((e, i) => stepRow(e, i, st)).join('')}</div>` : ''}
      ${replyHtml ? `<div class="row assistant"><div class="avatar">✦</div><div class="bubble">${replyHtml}</div></div>` : ''}
    </div>
    ${trace.length ? filmstrip(trace, st) : ''}`;
  if (typing) {
    const log = $('#rp-stage .rp-transcript');
    if (log) log.scrollTop = log.scrollHeight;
  }
}

// Horizontal lane of tool chips; the one currently resolving pulses.
function filmstrip(trace, st) {
  const cells = trace.map((e, i) => {
    const s = st.steps.get(i);
    const cls = !s?.started ? 'idle' : !s.done ? 'active' : (e.ok ? 'done' : 'fail');
    return `<span class="rp-cell ${cls}" title="${esc(e.name || '')}">${esc(e.name || '?')}</span>`;
  }).join('<span class="rp-arrow">→</span>');
  return `<div class="rp-filmstrip">${cells}</div>`;
}

function renderTransport() {
  const t = $('#rp-transport');
  if (!frames.length) { t.innerHTML = ''; return; }
  t.innerHTML = `
    <button id="rp-restart" class="rp-tbtn" type="button" title="Restart">⏮</button>
    <button id="rp-play" class="rp-tbtn" type="button" title="Play / pause">${playing ? '⏸' : '▶'}</button>
    <button id="rp-speed" class="rp-tbtn" type="button" title="Speed">${speed}×</button>
    <input id="rp-scrub" class="rp-scrub" type="range" min="0" max="${frames.length - 1}" value="${idx}" />
    <span class="rp-count">${idx + 1}/${frames.length}</span>`;
  $('#rp-restart').addEventListener('click', restart);
  $('#rp-play').addEventListener('click', togglePlay);
  $('#rp-speed').addEventListener('click', cycleSpeed);
  $('#rp-scrub').addEventListener('input', (e) => seek(Number(e.target.value)));
}

function renderFrame() {
  renderStage();
  // Keep the scrubber + counter live without rebuilding the buttons each tick.
  const scrub = $('#rp-scrub');
  if (scrub) { scrub.value = String(idx); $('#rp-count').textContent = `${idx + 1}/${frames.length}`; }
  else renderTransport();
}

function stop() { clearTimeout(timer); timer = null; playing = false; }

function scheduleNext() {
  if (!playing) return;
  if (idx >= frames.length - 1) { playing = false; renderTransport(); return; }
  const dur = ({ prompt: DUR.prompt, end: DUR.end, reply: DUR.reply }[frames[idx + 1].kind])
    ?? (frames[idx + 1].phase === 'start' ? DUR.toolStart : DUR.toolDone);
  timer = setTimeout(() => { idx += 1; renderFrame(); scheduleNext(); }, dur / speed);
}

function play() {
  if (!frames.length) return;
  if (idx >= frames.length - 1) idx = 0; // replay from the top
  playing = true;
  renderFrame();
  renderTransport();
  scheduleNext();
}
function pause() { stop(); renderTransport(); }
function togglePlay() { playing ? pause() : play(); }
function restart() { stop(); idx = 0; renderFrame(); renderTransport(); }
function cycleSpeed() {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  renderTransport();
}
function seek(n) {
  stop();
  idx = Math.max(0, Math.min(n, frames.length - 1));
  renderFrame();
  renderTransport();
}

function selectRow(r) {
  stop();
  row = r;
  frames = buildFrames(r);
  idx = 0;
  for (const b of document.querySelectorAll('#rp-list .rp-item')) b.classList.toggle('sel', b.dataset.id === String(r.id));
  play();
}

function renderList() {
  const list = $('#rp-list');
  if (!rows.length) { list.innerHTML = '<div class="rp-empty">No runs logged yet.</div>'; return; }
  list.innerHTML = rows.map((r) => {
    const meta = [r.model || '?', r.task, r.ms ? fmtMs(r.ms) : '']
      .filter(Boolean).join(' · ');
    const verdict = r.kind !== 'chat' && r.pass !== null ? (r.pass ? ' ✓' : ' ✗') : '';
    const sel = row && String(r.id) === String(row.id) ? ' sel' : '';
    return `<button type="button" class="rp-item${sel} ${r.error ? 'bad' : ''}" data-id="${r.id}">
      <span class="rp-item-top">${KIND[r.kind] || '·'} ${esc(meta)}${verdict}</span>
      <span class="rp-item-msg">${esc((r.user_msg || '').slice(0, LOGS_UI.userPreviewChars))}</span>
    </button>`;
  }).join('');
  for (const b of list.querySelectorAll('.rp-item')) {
    b.addEventListener('click', () => selectRow(rows.find((r) => String(r.id) === b.dataset.id)));
  }
}

export async function renderReplayView() {
  stop();
  const panel = $('#view-replay');
  panel.innerHTML = `
    <div class="sys-summary">Replay — watch a logged run play back step by step</div>
    <div class="rp-wrap">
      <div class="rp-side">
        <div class="rp-side-head"><span>Recent runs</span><button id="rp-refresh" class="rp-tbtn" type="button" title="Refresh">⟳</button></div>
        <div id="rp-list" class="rp-list"></div>
      </div>
      <div class="rp-main">
        <div id="rp-stage" class="rp-stage"></div>
        <div id="rp-transport" class="rp-transport"></div>
      </div>
    </div>`;
  $('#rp-refresh').addEventListener('click', loadRows);
  row = null;
  frames = [];
  await loadRows();
}

async function loadRows() {
  const want = pendingId;
  pendingId = null;
  try {
    rows = await api(`/api/logs?limit=${LOGS_UI.apiLimit}`);
  } catch {
    rows = [];
    $('#rp-list').innerHTML = '<div class="rp-empty">Logs are offline.</div>';
    return;
  }
  renderList();
  const target = want ? rows.find((r) => String(r.id) === want) : null;
  if (target) { selectRow(target); return; }
  renderStage();
  // Auto-load the most recent run so the stage isn't empty.
  if (rows.length && !row) selectRow(rows[0]);
}

// Jump straight to one run's playback (used by the Logs view's 🎬 buttons).
export function replayRun(id) {
  pendingId = String(id);
  showView('replay');
}

// Pause whenever we leave the Replay view so no timer runs in the background.
subscribe('view', (v) => { if (v !== 'replay') stop(); });

// A finished copilot run is already logged by the time its 'done' event
// arrives, so refresh the rail in place; the current playback is untouched.
subscribe('agent', (a) => { if (a.phase === 'done' && store.view === 'replay') loadRows(); });
