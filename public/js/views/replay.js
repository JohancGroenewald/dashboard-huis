// Replay view: pick a logged run and watch it play back like a recording —
// the prompt appears, each tool call resolves one at a time, then the reply
// streams in. Transport controls (play/pause/restart/speed/scrubber) drive a
// deterministic frame timeline rebuilt from the stored trace + reply, so the
// scrubber can jump anywhere and the stage re-derives exactly.
import { $, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { mdToHtml } from '../lib/markdown.js';
import { fmtMs } from '../lib/format.js';
import { toolIntentLabel, toolIntentState, toolIntentTitle } from '../lib/tool-intent.js';
import { LOGS_UI, STORAGE_KEYS } from '../constants.js';
import { store, subscribe } from '../state/store.js';
import { showView } from '../workspaces.js';

const KIND = { chat: '💬', validate: '🧪', redteam: '🛡️' };
// Per-frame display time at 1× (ms); the scheduler divides by the speed.
const DUR = { prompt: 600, toolStart: 480, toolDone: 320, think: 30, say: 50, reply: 55, end: 500 };
const SPEEDS = [1, 2, 4];

let rows = [];
let row = null;
let pendingId = null; // run to auto-select on the next load (set by replayRun)
// Off by default: fake-model and aborted runs show unless ticked away.
let hideFake = localStorage.getItem(STORAGE_KEYS.replayHideFake) === '1';
let hideAborted = localStorage.getItem(STORAGE_KEYS.replayHideAborted) === '1';

const logsUrl = (limit) =>
  `/api/logs?limit=${limit}`
  + (hideFake ? `&excludeModel=${encodeURIComponent(LOGS_UI.fakeModel)}` : '')
  + (hideAborted ? `&excludeError=${encodeURIComponent(LOGS_UI.abortedError)}` : '');
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

// Word-chunked frames for a streamed text block (~24 frames max per block).
function pushTextFrames(f, kind, r, text) {
  const total = countWords(text || '');
  if (!total) return;
  const stepN = Math.max(1, Math.round(total / 24));
  for (let n = stepN; n < total; n += stepN) f.push({ kind, r, upto: n });
  f.push({ kind, r, upto: total });
}

// Flatten one run into an ordered list of frames. With rounds logged, each
// chat round plays as: thinking → interim remark → its tool calls; the final
// round's content is the reply itself, which streams at the end as before.
function buildFrames(run) {
  const f = [{ kind: 'prompt' }];
  const trace = run.trace || [];
  const rounds = Array.isArray(run.rounds) ? run.rounds : [];
  let ti = 0;
  rounds.forEach((rd, ri) => {
    pushTextFrames(f, 'think', ri, rd.thinking);
    if (rd.calls) {
      pushTextFrames(f, 'say', ri, rd.content);
      for (let c = 0; c < rd.calls && ti < trace.length; c += 1, ti += 1) {
        f.push({ kind: 'tool', i: ti, phase: 'start' }, { kind: 'tool', i: ti, phase: 'done' });
      }
    }
  });
  // Old rows have no rounds; play any unclaimed tool calls flat, as before.
  for (; ti < trace.length; ti += 1) f.push({ kind: 'tool', i: ti, phase: 'start' }, { kind: 'tool', i: ti, phase: 'done' });
  pushTextFrames(f, 'reply', null, run.reply);
  f.push({ kind: 'end' });
  return f;
}

// Cumulative stage state after playing frames[0..idx].
function stateAt(i) {
  const st = { steps: new Map(), text: new Map(), replyWords: 0, ended: false };
  for (let k = 0; k <= i && k < frames.length; k++) {
    const f = frames[k];
    if (f.kind === 'tool') {
      const s = st.steps.get(f.i) || { started: false, done: false };
      if (f.phase === 'start') s.started = true; else s.done = true;
      st.steps.set(f.i, s);
    } else if (f.kind === 'reply') st.replyWords = f.upto;
    else if (f.kind === 'think' || f.kind === 'say') st.text.set(`${f.kind}-${f.r}`, f.upto);
    else if (f.kind === 'end') st.ended = true;
  }
  return st;
}

const openSteps = new Set(); // indexes whose args/result detail is expanded

function stepRow(e, i, state) {
  const s = state.steps.get(i);
  const status = !s?.started ? 'pending' : !s.done ? 'running' : (e.ok ? 'ok' : 'bad');
  const glyph = status === 'pending' ? '·' : status === 'running' ? '◌' : e.ok ? '✓' : '✗';
  const sub = s?.done ? stepSummary(e) : '';
  const open = s?.done && openSteps.has(i);
  const row = `<div class="step ${status}${s?.done ? ' expandable' : ''}"${s?.done ? ` data-step="${i}" title="${open ? 'Hide' : 'Show'} call details"` : ''}>
    <span class="step-status">${glyph}</span>
    <span class="step-name">${esc(e.name || '?')}</span>
    <span class="step-sub">${esc(sub)}</span>
    ${s?.done ? `<span class="step-caret">${open ? '▾' : '▸'}</span>` : ''}
  </div>`;
  if (!open) return row;
  return row + `<div class="step-detail">
    <div class="step-detail-k">args</div>
    <pre>${esc(JSON.stringify(e.args ?? {}, null, 1))}</pre>
    <div class="step-detail-k">${e.ok ? 'result' : 'error'}</div>
    <pre>${esc(JSON.stringify((e.ok ? e.result : { error: e.error }) ?? null, null, 1))}</pre>
  </div>`;
}

// The model's hidden reasoning for one round, revealed word by word.
function thinkBlock(text, ri, st) {
  const shown = st.text.get(`think-${ri}`) || 0;
  if (!shown) return '';
  const partial = shown < countWords(text);
  return `<div class="rp-think"><span class="rp-think-tag">💭 thinking</span>${esc(sliceWords(text, shown))}${partial ? '<span class="cursor"></span>' : ''}</div>`;
}

// What the model said out loud alongside its tool calls (not the final reply).
function sayBubble(text, ri, st) {
  const shown = st.text.get(`say-${ri}`) || 0;
  if (!shown) return '';
  const full = shown >= countWords(text);
  const body = full ? mdToHtml(text) : `${esc(sliceWords(text, shown))}<span class="cursor"></span>`;
  return `<div class="row assistant interim"><div class="avatar">✦</div><div class="bubble">${body}</div></div>`;
}

function toolIntentBadge(intent) {
  const state = toolIntentState(intent);
  if (!state) return '';
  return `<div class="tool-intent-badge ${state}" title="${esc(toolIntentTitle(intent))}">
    <span class="tool-intent-dot"></span><span>${esc(toolIntentLabel(intent))}</span>
  </div>`;
}

function renderStage() {
  const stage = $('#rp-stage');
  if (!row) { stage.innerHTML = '<div class="rp-empty">Pick a run on the left to play it back.</div>'; return; }
  const st = stateAt(idx);
  const trace = row.trace || [];
  const rounds = Array.isArray(row.rounds) ? row.rounds : [];
  const verdict = row.kind !== 'chat' && row.pass !== null ? (row.pass ? '✓ pass' : '✗ fail') : '';
  const total = countWords(row.reply || '');
  const cur = frames[idx];
  const typing = !st.ended && (cur?.kind === 'think' || cur?.kind === 'say' || cur?.kind === 'reply');
  const showIntent = st.ended || row.error || (total > 0 && st.replyWords >= total);
  const replyHtml = row.error
    ? `<div class="rp-error">⚠️ ${esc(row.error)}</div>`
    : st.ended || (total && st.replyWords >= total)
      ? mdToHtml(row.reply || '(no reply)')
      : (st.replyWords > 0 ? `${esc(sliceWords(row.reply, st.replyWords))}<span class="cursor"></span>` : '');

  // Interleave each round's thinking / interim remark with its tool calls.
  let ti = 0;
  let flow = '';
  rounds.forEach((rd, ri) => {
    flow += thinkBlock(rd.thinking || '', ri, st);
    if (rd.calls) {
      flow += sayBubble(rd.content || '', ri, st);
      flow += `<div class="steps">${trace.slice(ti, ti + rd.calls).map((e, k) => stepRow(e, ti + k, st)).join('')}</div>`;
      ti += rd.calls;
    }
  });
  const rest = trace.slice(ti).map((e, k) => stepRow(e, ti + k, st)).join('');
  if (rest) flow += `<div class="steps">${rest}</div>`;

  stage.innerHTML = `
    <div class="rp-stage-head">
      <span class="rp-badge">${KIND[row.kind] || '·'} ${esc(row.model || '?')}</span>
      ${row.task ? `<span class="rp-chip">${esc(row.task)}</span>` : ''}
      ${verdict ? `<span class="rp-chip ${row.pass ? 'ok' : 'bad'}">${verdict}</span>` : ''}
      ${row.ms ? `<span class="rp-chip">${fmtMs(row.ms)}</span>` : ''}
      <span class="rp-chip">${trace.length} tool call${trace.length === 1 ? '' : 's'}</span>
      ${rounds.length ? `<span class="rp-chip">${rounds.length} round${rounds.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="rp-transcript">
      <div class="row user"><div class="bubble">${esc(row.user_msg || '(no prompt)')}</div></div>
      ${flow}
      ${replyHtml ? `<div class="row assistant"><div class="avatar">✦</div><div class="bubble">${replyHtml}</div></div>` : ''}
      ${showIntent ? toolIntentBadge(row.toolIntent) : ''}
    </div>
    ${trace.length ? filmstrip(trace, st) : ''}`;
  for (const el of stage.querySelectorAll('.step[data-step]')) {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.step);
      if (openSteps.has(i)) openSteps.delete(i); else openSteps.add(i);
      renderStage();
    });
  }
  if (typing) {
    const log = $('#rp-stage .rp-transcript');
    if (log) log.scrollTop = log.scrollHeight;
    // Long thinking blocks scroll internally; keep the tail in view while
    // they stream (innerHTML rebuilds reset inner scroll positions).
    if (cur?.kind === 'think' && log) {
      const ths = log.querySelectorAll('.rp-think');
      if (ths.length) { const t = ths[ths.length - 1]; t.scrollTop = t.scrollHeight; }
    }
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
    <span id="rp-count" class="rp-count">${idx + 1}/${frames.length}</span>`;
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
  const next = frames[idx + 1];
  const dur = ({ prompt: DUR.prompt, end: DUR.end, reply: DUR.reply, think: DUR.think, say: DUR.say }[next.kind])
    ?? (next.phase === 'start' ? DUR.toolStart : DUR.toolDone);
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
  openSteps.clear();
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
        <div class="rp-side-head">
          <span>Recent runs</span>
          <span class="rp-side-tools">
            <label class="rp-filter" title="Hide the validation harness's fake-model runs"><input id="rp-nofake" type="checkbox" /> hide fake</label>
            <label class="rp-filter" title="Hide runs that were cancelled or timed out"><input id="rp-noaborted" type="checkbox" /> hide aborted</label>
            <button id="rp-refresh" class="rp-tbtn" type="button" title="Refresh">⟳</button>
          </span>
        </div>
        <div id="rp-list" class="rp-list"></div>
      </div>
      <div class="rp-main">
        <div id="rp-stage" class="rp-stage"></div>
        <div id="rp-transport" class="rp-transport"></div>
      </div>
    </div>`;
  $('#rp-refresh').addEventListener('click', loadRows);
  const noFake = $('#rp-nofake');
  noFake.checked = hideFake;
  noFake.addEventListener('change', () => {
    hideFake = noFake.checked;
    localStorage.setItem(STORAGE_KEYS.replayHideFake, hideFake ? '1' : '0');
    loadRows();
  });
  const noAborted = $('#rp-noaborted');
  noAborted.checked = hideAborted;
  noAborted.addEventListener('change', () => {
    hideAborted = noAborted.checked;
    localStorage.setItem(STORAGE_KEYS.replayHideAborted, hideAborted ? '1' : '0');
    loadRows();
  });
  row = null;
  frames = [];
  await loadRows();
}

function setFresh(on) {
  const btn = $('#rp-refresh');
  if (!btn) return;
  btn.classList.toggle('fresh', on);
  btn.title = on ? 'New runs available — refresh' : 'Refresh';
}

// Quietly check whether newer runs exist than the rail shows; if so, light
// up the refresh button rather than yanking the list around mid-browse.
async function checkFresh() {
  try {
    const [latest] = await api(logsUrl(1));
    if (latest && !rows.some((r) => String(r.id) === String(latest.id))) setFresh(true);
  } catch { /* offline — the rail already says so */ }
}

async function loadRows() {
  const want = pendingId;
  pendingId = null;
  try {
    rows = await api(logsUrl(LOGS_UI.apiLimit));
  } catch {
    rows = [];
    $('#rp-list').innerHTML = '<div class="rp-empty">Logs are offline.</div>';
    return;
  }
  setFresh(false);
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
// arrives; glow the refresh button instead of reloading the rail in place.
subscribe('agent', (a) => { if (a.phase === 'done' && store.view === 'replay') checkFresh(); });
