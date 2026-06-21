// The copilot conversation: streamed replies, live step timeline, revert bar,
// choice/follow-up chips, input history, and localStorage restore.
import { $, h } from '../lib/dom.js';
import { clientId } from '../lib/api.js';
import { streamSse } from '../lib/sse.js';
import { mdToHtml } from '../lib/markdown.js';
import { toolIntentLabel, toolIntentState, toolIntentTitle } from '../lib/tool-intent.js';
import { DOCK_UI, SPEED_LIMITS, STORAGE_KEYS } from '../constants.js';
import { store, loadDashboard } from '../state/store.js';
import { activeModel, modelHasVision } from './models.js';
import { addAttachment, addImageAttachment, hasImageAttachments, consumeAttachments } from './attachments.js';
import { createStepTimeline, showRunBar } from './steps.js';
import { openDock } from './dock.js';
import { initVoiceInput } from './voice.js';

const log = $('#dock-log');
const input = $('#dock-input');
const history = [];
const inputHistory = [];
let histIdx = -1;
let histDraft = '';
let SESSION = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
let busy = false;

const INTRO = `<div class="intro">
  <div class="intro-avatar">✦</div>
  <p>Hi — I'm <strong>Dashy</strong>. I can add, edit, move, group, or remove tiles, sections and notes — just ask. Changes light up on the board as I make them, and every run can be reverted.</p>
  <div class="suggestions">
    <button class="suggestion" type="button">Add a Grafana tile to a new Monitoring section</button>
    <button class="suggestion" type="button">Add a sticky note to call the plumber</button>
    <button class="suggestion" type="button">Group my media apps into a Media section</button>
  </div>
</div>`;

const scroll = () => { log.scrollTop = log.scrollHeight; };

function wireSuggestions() {
  for (const b of log.querySelectorAll('.suggestion')) {
    b.addEventListener('click', () => { input.value = b.textContent; autoGrow(); input.focus(); });
  }
}

function saveChat() {
  // Pasted images are session-only: too big for localStorage, gone on reload.
  const slim = history.map(({ images: _images, ...m }) => m);
  try { localStorage.setItem(STORAGE_KEYS.chat, JSON.stringify({ session: SESSION, history: slim })); } catch { /* quota */ }
}

// What actually goes to the model: ticked messages only, payload fields only.
const contextMessages = () =>
  history.filter((m) => !m.off).map(({ role, content, images }) => ({ role, content, ...(images ? { images } : {}) }));

// The tick beside each message: ✓ = sent with the next prompt (the default),
// unticked = kept out of context — for cutting a hallucinated exchange loose
// when switching models without losing the transcript.
function tickEl(entry) {
  const b = h('button', { class: 'msg-tick', type: 'button' });
  const sync = () => {
    b.classList.toggle('on', !entry.off);
    b.textContent = entry.off ? '' : '✓';
    b.title = entry.off ? 'Excluded from the next prompt — click to include' : 'Sent with the next prompt — click to exclude';
    b.closest('.row')?.classList.toggle('excluded', Boolean(entry.off));
  };
  b.addEventListener('click', () => {
    entry.off = !entry.off;
    sync();
    saveChat();
  });
  sync();
  return b;
}

function addMsg(role, text, thumbs = [], entry = null) {
  log.querySelector('.intro')?.remove();
  const row = h('div', { class: `row ${role}${entry?.off ? ' excluded' : ''}` });
  if (role === 'assistant' || role === 'error') row.append(h('div', { class: 'avatar' }, role === 'error' ? '⚠️' : '✦'));
  const bubble = h('div', { class: 'bubble' });
  if (role === 'assistant') bubble.innerHTML = mdToHtml(text);
  else bubble.textContent = text;
  if (thumbs.length) {
    const wrap = h('div', { class: 'msg-imgs' });
    for (const t of thumbs) wrap.append(h('img', { src: t, alt: '' }));
    bubble.append(wrap);
  }
  if (role === 'user') {
    // Retry resends the prompt text as-is (pasted images are session-only).
    const retry = h('button', { class: 'msg-retry', type: 'button', title: 'Send this prompt again', onclick: () => sendChat(text) }, '↻');
    row.append(retry, bubble);
  } else {
    row.append(bubble);
  }
  if (entry) row.append(tickEl(entry));
  log.append(row);
  scroll();
  return bubble;
}

function clearChips() {
  for (const r of log.querySelectorAll('.choices-row, .followups-row')) r.remove();
}

function renderChoices(choices = []) {
  if (!choices.length) return;
  const row = h('div', { class: 'choices-row' });
  for (const c of choices) {
    row.append(h('button', { class: 'choice-btn', type: 'button', onclick: () => { row.remove(); sendChat(String(c)); } }, String(c)));
  }
  log.append(row);
  scroll();
}

function renderFollowups(items = []) {
  if (!items.length) return;
  const row = h('div', { class: 'followups-row' });
  for (const s of items) {
    row.append(h('button', {
      class: 'followup-chip',
      type: 'button',
      onclick: () => { input.value = s; autoGrow(); input.focus(); },
    }, s));
  }
  log.append(row);
  scroll();
}

function renderToolIntentBadge(intent, calls) {
  const state = toolIntentState(intent, calls);
  if (!state) return null;
  return h('div', {
    class: `tool-intent-badge ${state}`,
    title: toolIntentTitle(intent, calls),
  }, h('span', { class: 'tool-intent-dot' }), h('span', {}, toolIntentLabel(intent, calls)));
}

// The streaming assistant turn: thinking dots → live tokens (with cursor)
// → final markdown. Tokens streamed before a tool call are scratch work and
// are cleared when the tool round starts.
function startTurn() {
  log.querySelector('.intro')?.remove();
  const turn = h('div', { class: 'turn' });
  const bubble = h('div', { class: 'bubble thinking' });
  bubble.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span class="think-time"></span>';
  const row = h('div', { class: 'row assistant' }, h('div', { class: 'avatar' }, '✦'), bubble);
  turn.append(row);
  log.append(turn);
  scroll();

  const t0 = Date.now();
  const timeEl = bubble.querySelector('.think-time');
  const timer = setInterval(() => {
    if (!bubble.classList.contains('thinking')) return;
    const s = Math.round((Date.now() - t0) / SPEED_LIMITS.msPerSecond);
    if (s < DOCK_UI.thinkingNoticeDelaySeconds) return;
    timeEl.textContent = s >= DOCK_UI.coldModelNoticeSeconds ? `${s}s · a cold model can take a while…` : `${s}s`;
  }, DOCK_UI.thinkingTimerMs);

  let streamed = '';
  return {
    turn,
    row,
    delta(text) {
      if (bubble.classList.contains('thinking')) {
        bubble.classList.remove('thinking');
        bubble.innerHTML = '<span class="stream"></span><span class="cursor"></span>';
      }
      streamed += text;
      bubble.querySelector('.stream').textContent = streamed;
      scroll();
    },
    // A tool round started: the streamed text was pre-tool scratch.
    resetStream() {
      streamed = '';
      if (!bubble.classList.contains('thinking')) bubble.querySelector('.stream').textContent = '';
    },
    finish(reply, toolIntent, calls) {
      clearInterval(timer);
      bubble.classList.remove('thinking');
      bubble.innerHTML = mdToHtml(reply || '(no reply)');
      const badge = renderToolIntentBadge(toolIntent, calls);
      if (badge) turn.append(badge);
      scroll();
    },
    fail(message) {
      clearInterval(timer);
      row.remove();
      addMsg('error', message);
    },
  };
}

export async function sendChat(text) {
  if (busy) return;
  openDock({ focus: false });
  if (!activeModel()) { addMsg('error', 'No validated model selected.'); return; }
  if (hasImageAttachments() && !modelHasVision(activeModel())) {
    addMsg('error', `${activeModel()} can't see images — pick a 👁 model from the picker, or remove the screenshot.`);
    return; // chips stay attached so switching model and resending just works
  }
  clearChips();
  inputHistory.push(text);
  histIdx = -1;

  const { text: content, images, thumbs } = consumeAttachments(text);
  const userEntry = { role: 'user', content, ...(images.length ? { images } : {}) };
  history.push(userEntry);
  addMsg('user', content, thumbs, userEntry);
  saveChat();

  busy = true;
  $('#dock-form button[type="submit"]').disabled = true;
  const view = startTurn();
  const timeline = createStepTimeline(view.turn);
  let done = null;

  try {
    await streamSse('/api/agent/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': clientId },
      body: JSON.stringify({ model: activeModel(), messages: contextMessages(), session: SESSION }),
    }, (event, data) => {
      if (event === 'delta') view.delta(data.text);
      else if (event === 'step') { view.resetStream(); timeline.start(data.i, data.name, data.ids); }
      else if (event === 'result') timeline.finish(data.i, data);
      else if (event === 'done') done = data;
      else if (event === 'error') throw new Error(data.message);
    });
    if (!done) throw new Error('the stream ended without a reply');

    view.finish(done.reply, done.toolIntent, (done.trace || []).length);
    const asstEntry = { role: 'assistant', content: done.reply || '' };
    history.push(asstEntry);
    view.row.append(tickEl(asstEntry));
    saveChat();

    if (done.canRevert) showRunBar(view.turn, done);
    const choiceCall = (done.trace || []).find((t) => t.ok && t.name === 'offer_choices');
    if (choiceCall) renderChoices(choiceCall.result?.offered || choiceCall.args?.choices || []);
    renderFollowups(done.followups || []);
    // The events channel keeps the board current; catch up if it lagged.
    if (store.rev < done.revAfter) await loadDashboard();
  } catch (err) {
    // No automatic re-send: the run may have completed server-side, and the
    // events channel has already applied whatever it changed.
    view.fail(`${err.message} — any changes Dashy made are still applied.`);
    await loadDashboard().catch(() => {});
  } finally {
    busy = false;
    $('#dock-form button[type="submit"]').disabled = false;
  }
}

// Per-card ✦ entry point: attach the item and focus the composer.
export function askAbout(item, prompt = '') {
  addAttachment(item);
  openDock();
  if (prompt) { input.value = prompt; autoGrow(); }
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

export function initChat() {
  log.innerHTML = INTRO;
  wireSuggestions();

  const caretEnd = () => input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('input', () => { autoGrow(); histIdx = -1; });
  // Pasting a screenshot attaches it as an image chip for the next prompt.
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) addImageAttachment(f);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#dock-form').requestSubmit(); return; }
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    if (e.key === 'ArrowUp' && inputHistory.length && (histIdx !== -1 || atStart)) {
      e.preventDefault();
      if (histIdx === -1) { histDraft = input.value; histIdx = inputHistory.length; }
      if (histIdx > 0) { histIdx -= 1; input.value = inputHistory[histIdx]; autoGrow(); caretEnd(); }
    } else if (e.key === 'ArrowDown' && histIdx !== -1) {
      e.preventDefault();
      if (histIdx < inputHistory.length - 1) { histIdx += 1; input.value = inputHistory[histIdx]; }
      else { histIdx = -1; input.value = histDraft; }
      autoGrow();
      caretEnd();
    }
  });
  $('#dock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    sendChat(text);
  });
  initVoiceInput({ input, onText: autoGrow });

  // New conversation: fresh session, clean transcript.
  $('#dock-new').addEventListener('click', () => {
    history.length = 0;
    SESSION = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    localStorage.removeItem(STORAGE_KEYS.chat);
    log.innerHTML = INTRO;
    wireSuggestions();
  });

  // The Models view picks a driver and hands focus here.
  document.addEventListener('select-model', () => openDock());

  // Restore the persisted conversation (same session, turns keep grouping).
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.chat) || '{}');
    if (saved.session) SESSION = saved.session;
    if (Array.isArray(saved.history) && saved.history.length) {
      for (const m of saved.history) {
        history.push(m);
        addMsg(m.role, m.content, [], m);
        if (m.role === 'user') inputHistory.push(m.content);
      }
    }
  } catch { /* corrupt */ }
}
