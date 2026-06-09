// Assistant: model picker, agent chat (markdown replies + tool trace), the
// tested-models report, and the abilities dropdown.
import { $, api, jsonBody, esc, fmtMs, speedTier, mdToHtml } from './util.js';
import { CHAT_UI, SPEED_LIMITS, STORAGE_KEYS } from './constants.js';
import { setState } from './store.js';

const chatLog = $('#chat-log');
const introHTML = chatLog.innerHTML; // captured before any restore, for "new chat"
const history = [];
const inputHistory = []; // past user prompts, for ↑/↓ recall
let histIdx = -1; // -1 = editing a fresh draft
let histDraft = '';
const attachments = []; // items the user attached as context for the next prompt

function renderAttachments() {
  const box = $('#chat-attachments');
  box.classList.toggle('hidden', attachments.length === 0);
  box.innerHTML = attachments
    .map((a, i) => `<span class="attach-chip">📎 ${esc(a.type)}: ${esc(a.label)}<button type="button" class="attach-x" data-i="${i}">✕</button></span>`)
    .join('');
  box.querySelectorAll('.attach-x').forEach((b) =>
    b.addEventListener('click', () => { attachments.splice(Number(b.dataset.i), 1); renderAttachments(); })
  );
}

document.addEventListener('attach-item', (e) => {
  const a = e.detail;
  if (!attachments.some((x) => x.id === a.id)) attachments.push(a);
  renderAttachments();
  $('#chat').classList.remove('hidden');
  $('#chat-input').focus();
});
let SESSION = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
let activeModel = '';

function setModel(m, ms) {
  activeModel = m;
  if (m) localStorage.setItem(STORAGE_KEYS.activeModel, m); // remember the picked driver
  $('#model-btn-label').innerHTML = m ? `${esc(m)}${ms ? ` <span class="pill-badge">${speedTier(ms)} ~${fmtMs(ms)}</span>` : ''}` : 'no models';
}

function saveChat() {
  try { localStorage.setItem(STORAGE_KEYS.chat, JSON.stringify({ session: SESSION, history })); } catch { /* quota */ }
}

export async function loadModels() {
  try {
    const { approved, details } = await api('/api/models');
    const menu = $('#model-menu');
    if (!approved.length) {
      menu.innerHTML = '<div class="mm-empty">No validated models. Run the gate first.</div>';
      setModel('', null);
    } else {
      menu.innerHTML = approved
        .map((m) => {
          const ms = details?.[m]?.msPerAction;
          const badge = ms ? `<span class="mm-badge">${speedTier(ms)} ~${fmtMs(ms)}</span>` : '';
          return `<button type="button" class="mm-item" data-model="${esc(m)}">${esc(m)}${badge}</button>`;
        })
        .join('');
      menu.querySelectorAll('.mm-item').forEach((it) =>
        it.addEventListener('click', () => {
          setModel(it.dataset.model, details?.[it.dataset.model]?.msPerAction);
          menu.classList.add('hidden');
        })
      );
      const saved = localStorage.getItem(STORAGE_KEYS.activeModel);
      const pick = activeModel && approved.includes(activeModel) ? activeModel
        : saved && approved.includes(saved) ? saved
        : approved[0];
      setModel(pick, details?.[pick]?.msPerAction);
    }
  } catch {
    setModel('', null);
    $('#model-btn-label').textContent = 'offline';
  }
}

// The Models workspace dispatches this when an approved tile is clicked.
document.addEventListener('select-model', (e) => {
  setModel(e.detail.model, e.detail.ms);
  $('#chat').classList.remove('hidden');
  $('#chat-input').focus();
});

function addMsg(role, text, trace) {
  $('#chat-log .intro')?.remove();
  const row = document.createElement('div');
  row.className = `row ${role}`;
  if (role === 'assistant' || role === 'error') {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = role === 'error' ? '⚠️' : '🤖';
    row.appendChild(av);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'assistant') bubble.innerHTML = mdToHtml(text);
  else bubble.textContent = text;
  if (trace?.length) {
    const t = document.createElement('div');
    t.className = 'trace';
    t.innerHTML = trace.map((e) => `<span class="tchip ${e.ok ? 'ok' : 'bad'}">${e.ok ? '✓' : '✗'} ${esc(e.name)}</span>`).join('');
    bubble.appendChild(t);
  }
  row.appendChild(bubble);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
  return row;
}

// Animated "thinking" placeholder while the model works. Shows bouncing dots,
// and after a few seconds an elapsed timer (a cold model load can take a while),
// so the user can tell it's busy rather than stuck. Returns { remove }.
function startThinking() {
  $('#chat-log .intro')?.remove();
  const row = document.createElement('div');
  row.className = 'row assistant';
  row.innerHTML = '<div class="avatar">🤖</div><div class="bubble thinking"><span class="dots"><span></span><span></span><span></span></span><span class="think-time"></span></div>';
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
  const t0 = Date.now();
  const timeEl = row.querySelector('.think-time');
  const timer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / SPEED_LIMITS.msPerSecond);
    if (s < CHAT_UI.thinkingNoticeDelaySeconds) return;
    timeEl.textContent = s >= CHAT_UI.coldModelNoticeSeconds ? `${s}s · a cold model can take a while…` : `${s}s`;
    chatLog.scrollTop = chatLog.scrollHeight;
  }, CHAT_UI.thinkingTimerMs);
  return { remove: () => { clearInterval(timer); row.remove(); } };
}

function renderChoices(choices) {
  if (!choices.length) return;
  const row = document.createElement('div');
  row.className = 'choices-row';
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice-btn';
    b.textContent = c;
    b.addEventListener('click', () => { row.remove(); sendChat(String(c)); });
    row.appendChild(b);
  }
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderFollowups(items) {
  if (!items.length) return;
  const row = document.createElement('div');
  row.className = 'followups-row';
  for (const s of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'followup-chip';
    b.textContent = s;
    // Pre-fill the composer (let the user tweak before sending).
    b.addEventListener('click', () => { const i = $('#chat-input'); i.value = s; i.dispatchEvent(new Event('input')); i.focus(); });
    row.appendChild(b);
  }
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChat(text) {
  if (!activeModel) return addMsg('error', 'No validated model selected.');
  document.querySelectorAll('.choices-row, .followups-row').forEach((r) => r.remove()); // clear stale chips
  inputHistory.push(text);
  histIdx = -1;
  let content = text;
  if (attachments.length) {
    // Hand the model the exact ids so it acts on the referenced items, no guessing.
    content = attachments.map((a) => `[${a.type} "${a.label}" id:${a.id}]`).join(' ') + `\n${text}`;
    attachments.length = 0;
    renderAttachments();
  }
  history.push({ role: 'user', content });
  addMsg('user', content);
  saveChat();
  const pending = startThinking();
  const btn = $('#chat-form button');
  btn.disabled = true;
  try {
    const data = await api('/api/agent/chat', jsonBody({ model: activeModel, messages: history, session: SESSION }));
    pending.remove();
    addMsg('assistant', data.reply || '(no reply)', data.trace);
    history.push({ role: 'assistant', content: data.reply || '' });
    saveChat();
    const choiceCall = (data.trace || []).find((t) => t.ok && t.name === 'offer_choices');
    if (choiceCall) renderChoices(choiceCall.result?.offered || choiceCall.args?.choices || []);
    if (data.followups) renderFollowups(data.followups);
    if (data.dashboard) setState(data.dashboard);
  } catch (err) {
    pending.remove();
    addMsg('error', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---- wiring ----
$('#chat-toggle').addEventListener('click', () => $('#chat').classList.toggle('hidden'));
$('#chat-close').addEventListener('click', () => $('#chat').classList.add('hidden'));

const modelMenu = $('#model-menu');
$('#model-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = modelMenu.classList.contains('hidden');
  modelMenu.classList.toggle('hidden');
  if (opening) loadModels(); // refresh so the list reflects current approvals/retirements
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.model-picker')) modelMenu.classList.add('hidden');
});

// ---- draggable / resizable assistant window ----
// Drag by the header; resize via the native bottom-right grip (CSS resize:both).
// Geometry is clamped into the viewport and persisted across reloads. Drag uses
// document-level listeners (robust across fast moves / leaving the header) plus
// touch-action:none on the handle so trackpad/touch drags aren't eaten by the
// browser's own scroll gesture.
function initAssistantWindow() {
  const win = $('#chat');
  const head = win.querySelector('.asst-head');
  const KEY = STORAGE_KEYS.assistantGeometry;

  // Move (and optionally size) the window, clamped so the header stays reachable.
  const place = ({ left, top, w, h }) => {
    if (w != null) win.style.width = `${Math.min(w, window.innerWidth)}px`;
    if (h != null) win.style.height = `${Math.min(h, window.innerHeight)}px`;
    win.style.left = `${Math.max(CHAT_UI.viewportMin, Math.min(left, window.innerWidth - CHAT_UI.minVisibleWidth))}px`;
    win.style.top = `${Math.max(CHAT_UI.viewportMin, Math.min(top, window.innerHeight - CHAT_UI.minVisibleHeight))}px`;
    win.style.right = 'auto';
  };
  const save = () => {
    const r = win.getBoundingClientRect();
    localStorage.setItem(KEY, JSON.stringify({ left: r.left, top: r.top, w: r.width, h: r.height }));
  };
  try { const g = JSON.parse(localStorage.getItem(KEY) || 'null'); if (g) place(g); } catch { /* ignore */ }

  let start = null;
  const onMove = (e) => {
    if (!start) return;
    e.preventDefault(); // suppress text selection while dragging
    place({ left: start.left + (e.clientX - start.x), top: start.top + (e.clientY - start.y) });
  };
  const onUp = () => {
    if (!start) return;
    start = null;
    win.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    save();
  };
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // left button only
    if (e.target.closest('button, .model-picker')) return; // controls aren't drag handles
    const r = win.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    win.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // Persist size changes from the native resize grip (debounced; skip when hidden).
  let rt;
  new ResizeObserver(() => {
    if (win.classList.contains('hidden') || start) return;
    clearTimeout(rt);
    rt = setTimeout(save, CHAT_UI.resizeSaveDebounceMs);
  }).observe(win);
}
initAssistantWindow();

const chatInput = $('#chat-input');
const autoGrow = () => { chatInput.style.height = 'auto'; chatInput.style.height = `${chatInput.scrollHeight}px`; };
const caretEnd = () => chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
chatInput.addEventListener('input', autoGrow);
chatInput.addEventListener('input', () => { histIdx = -1; }); // typing exits history nav
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); return; }
  // ↑ recalls older prompts (when the caret is at the very start, or already navigating)
  const atStart = chatInput.selectionStart === 0 && chatInput.selectionEnd === 0;
  if (e.key === 'ArrowUp' && inputHistory.length && (histIdx !== -1 || atStart)) {
    e.preventDefault();
    if (histIdx === -1) { histDraft = chatInput.value; histIdx = inputHistory.length; }
    if (histIdx > 0) { histIdx -= 1; chatInput.value = inputHistory[histIdx]; autoGrow(); caretEnd(); }
  } else if (e.key === 'ArrowDown' && histIdx !== -1) {
    e.preventDefault();
    if (histIdx < inputHistory.length - 1) { histIdx += 1; chatInput.value = inputHistory[histIdx]; }
    else { histIdx = -1; chatInput.value = histDraft; }
    autoGrow(); caretEnd();
  }
});
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  autoGrow();
  $('#chat').classList.remove('hidden');
  sendChat(text);
});
function wireSuggestions() {
  document.querySelectorAll('.suggestion').forEach((b) =>
    b.addEventListener('click', () => { chatInput.value = b.textContent; autoGrow(); chatInput.focus(); })
  );
}
wireSuggestions();

// New conversation: clear history + transcript, start a fresh session.
$('#chat-new').addEventListener('click', () => {
  history.length = 0;
  SESSION = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  localStorage.removeItem(STORAGE_KEYS.chat);
  chatLog.innerHTML = introHTML;
  wireSuggestions();
});

// Restore a persisted conversation (same session, so new turns keep grouping).
(function restoreChat() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.chat) || '{}'); } catch { /* corrupt */ }
  if (saved.session) SESSION = saved.session;
  if (Array.isArray(saved.history) && saved.history.length) {
    for (const m of saved.history) {
      history.push(m);
      addMsg(m.role, m.content);
      if (m.role === 'user') inputHistory.push(m.content);
    }
  }
})();
