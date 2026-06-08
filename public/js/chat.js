// Assistant: model picker, agent chat (markdown replies + tool trace), the
// tested-models report, and the abilities dropdown.
import { $, api, jsonBody, esc, fmtMs, speedTier, mdToHtml } from './util.js';
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
  if (m) localStorage.setItem('dash-model', m); // remember the picked driver
  $('#model-btn-label').innerHTML = m ? `${esc(m)}${ms ? ` <span class="pill-badge">${speedTier(ms)} ~${fmtMs(ms)}</span>` : ''}` : 'no models';
}

function saveChat() {
  try { localStorage.setItem('dash-chat', JSON.stringify({ session: SESSION, history })); } catch { /* quota */ }
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
      const saved = localStorage.getItem('dash-model');
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
  const pending = addMsg('assistant', '…');
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

const abilitiesMenu = $('#abilities-menu');
let abilitiesLoaded = false;

async function loadAbilities() {
  try {
    const tools = await api('/api/abilities');
    abilitiesMenu.innerHTML =
      `<div class="mr-head">${tools.length} agent abilities</div>` +
      tools
        .map(
          (t) => `<div class="ab-item">
            <div class="ab-name">${esc(t.name)}</div>
            <div class="ab-desc">${esc(t.description)}</div>
            ${t.params.length ? `<div class="ab-params">${t.params.map((p) => `<span class="ab-param${t.required.includes(p) ? ' req' : ''}">${esc(p)}</span>`).join('')}</div>` : ''}
          </div>`
        )
        .join('');
  } catch {
    abilitiesMenu.innerHTML = '<div class="mr-empty">offline</div>';
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

const closeOtherDropdowns = (keep) =>
  document.querySelectorAll('.topbar .dropdown-menu').forEach((m) => { if (m.id !== keep) m.classList.add('hidden'); });
$('#abilities-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  closeOtherDropdowns('abilities-menu');
  const opening = abilitiesMenu.classList.contains('hidden');
  abilitiesMenu.classList.toggle('hidden');
  if (opening && !abilitiesLoaded) { loadAbilities(); abilitiesLoaded = true; }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.model-picker')) modelMenu.classList.add('hidden');
  if (!e.target.closest('.dropdown')) abilitiesMenu.classList.add('hidden');
});

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
  localStorage.removeItem('dash-chat');
  chatLog.innerHTML = introHTML;
  wireSuggestions();
});

// Restore a persisted conversation (same session, so new turns keep grouping).
(function restoreChat() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('dash-chat') || '{}'); } catch { /* corrupt */ }
  if (saved.session) SESSION = saved.session;
  if (Array.isArray(saved.history) && saved.history.length) {
    for (const m of saved.history) {
      history.push(m);
      addMsg(m.role, m.content);
      if (m.role === 'user') inputHistory.push(m.content);
    }
  }
})();
