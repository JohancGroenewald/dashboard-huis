// Assistant: model picker, agent chat (markdown replies + tool trace), the
// tested-models report, and the abilities dropdown.
import { $, api, jsonBody, esc, fmtMs, speedTier, mdToHtml } from './util.js';
import { setState } from './store.js';

const chatLog = $('#chat-log');
const history = [];
const SESSION = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
let activeModel = '';

function setModel(m, ms) {
  activeModel = m;
  $('#model-btn-label').innerHTML = m ? `${esc(m)}${ms ? ` <span class="pill-badge">${speedTier(ms)} ~${fmtMs(ms)}</span>` : ''}` : 'no models';
  $('#model-menu').classList.add('hidden');
}

export async function loadModels() {
  try {
    const { approved, details, results, supervised, delegated, parallel } = await api('/api/models');
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
        it.addEventListener('click', () => setModel(it.dataset.model, details?.[it.dataset.model]?.msPerAction))
      );
      if (!activeModel || !approved.includes(activeModel)) setModel(approved[0], details?.[approved[0]]?.msPerAction);
    }
    renderModelsReport(results || {}, supervised || {}, delegated || {}, parallel || {});
  } catch {
    setModel('', null);
    $('#model-btn-label').textContent = 'offline';
  }
}

function pairRow(useful, name, sub) {
  return `<div class="mr-row ${useful ? 'ok' : 'bad'}"><span class="mr-badge">${useful ? '✓' : '✗'}</span><div class="mr-body">${name}${sub}</div></div>`;
}
function renderSupervised(supervised) {
  const pairs = Object.values(supervised);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((s) => {
    const spd = s.supervisorAloneMs ? `~${fmtMs(s.msPerAction)} vs ${fmtMs(s.supervisorAloneMs)} solo (${s.speedup}×)` : `~${fmtMs(s.msPerAction)}`;
    return pairRow(s.useful, `<div class="mr-name">${esc(s.worker)} <span class="mr-sub">▸ sup: ${esc(s.supervisor)}</span></div>`, `<div class="mr-sub">safe ${s.safetyPass ? '✓' : '✗'} · capable ${s.capabilityPass ? '✓' : '✗'} · ${spd} · ${s.totalBlocked} blocked</div>`);
  }).join('');
  return `<div class="mr-head">supervised pairings (worker ▸ supervisor)</div>${rows}`;
}
function renderDelegated(delegated) {
  const pairs = Object.values(delegated);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((d) => {
    const spd = d.orchestratorAloneMs ? `~${fmtMs(d.msPerAction)} vs ${fmtMs(d.orchestratorAloneMs)} solo (${d.speedup}×)` : `~${fmtMs(d.msPerAction)}`;
    return pairRow(d.useful, `<div class="mr-name">${esc(d.orchestrator)} <span class="mr-sub">▸ sub: ${esc(d.subAgent)}</span></div>`, `<div class="mr-sub">safe ${d.safetyPass ? '✓' : '✗'} · capable ${d.capabilityPass ? '✓' : '✗'} · ${spd}</div>`);
  }).join('');
  return `<div class="mr-head">sub-agent delegation (orchestrator ▸ sub-agent)</div>${rows}`;
}
function renderParallel(parallel) {
  const pairs = Object.values(parallel);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((p) => {
    const spd = p.orchestratorAloneMs ? `~${fmtMs(p.msPerAction)} vs ${fmtMs(p.orchestratorAloneMs)} solo (${p.speedup}×)` : `~${fmtMs(p.msPerAction)}`;
    const cfg = p.temperatures ? `<div class="mr-sub">temps [${esc(p.temperatures.join(', '))}] · ctx ${esc(p.numCtx)}</div>` : '';
    return pairRow(p.useful, `<div class="mr-name">${esc(p.orchestrator)} <span class="mr-sub">⇉ ${esc((p.subAgents || []).join(' + '))}</span></div>`, `<div class="mr-sub">safe ${p.safetyPass ? '✓' : '✗'} · capable ${p.capabilityPass ? '✓' : '✗'} · ${spd}</div>${cfg}`);
  }).join('');
  return `<div class="mr-head">parallel sub-agents (orchestrator ⇉ concurrent)</div>${rows}`;
}

function renderModelsReport(results, supervised = {}, delegated = {}, parallel = {}) {
  const menu = $('#models-menu');
  const extras = renderSupervised(supervised) + renderDelegated(delegated) + renderParallel(parallel);
  const entries = Object.entries(results);
  if (!entries.length) {
    menu.innerHTML = '<div class="mr-empty">No models validated yet.</div>' + extras;
    return;
  }
  entries.sort((a, b) => Number(b[1].approved) - Number(a[1].approved) || b[1].score - a[1].score);
  const approvedCount = entries.filter(([, r]) => r.approved).length;
  const rows = entries.map(([name, r]) => {
    const time = r.msPerAction ? `${speedTier(r.msPerAction)} ~${fmtMs(r.msPerAction)}/action` : '';
    const blocked = r.blockedBy?.length
      ? `<div class="mr-fail">✗ safety: ${esc(r.blockedBy.map((t) => `${t.replace('safety-', '')} ${r.safety?.[t] || ''}`).join(', '))}</div>`
      : r.failures?.length ? `<div class="mr-fail">✗ ${esc(r.failures.join(', '))}</div>` : '';
    const err = r.error ? `<div class="mr-fail">${esc(r.error)}</div>` : '';
    return `<div class="mr-row ${r.approved ? 'ok' : 'bad'}"><span class="mr-badge">${r.approved ? '✓' : '✗'}</span><div class="mr-body"><div class="mr-name">${esc(name)}</div><div class="mr-sub">${r.passed}/${r.total}${time ? ' · ' + time : ''}</div>${blocked}${err}</div></div>`;
  }).join('');
  menu.innerHTML = `<div class="mr-head">${approvedCount} approved · ${entries.length} tested</div>${rows}${extras}`;
}

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

async function sendChat(text) {
  if (!activeModel) return addMsg('error', 'No validated model selected.');
  history.push({ role: 'user', content: text });
  addMsg('user', text);
  const pending = addMsg('assistant', '…');
  const btn = $('#chat-form button');
  btn.disabled = true;
  try {
    const data = await api('/api/agent/chat', jsonBody({ model: activeModel, messages: history, session: SESSION }));
    pending.remove();
    addMsg('assistant', data.reply || '(no reply)', data.trace);
    history.push({ role: 'assistant', content: data.reply || '' });
    if (data.dashboard) setState(data.dashboard);
  } catch (err) {
    pending.remove();
    addMsg('error', err.message);
  } finally {
    btn.disabled = false;
  }
}

const modelsMenu = $('#models-menu');
const abilitiesMenu = $('#abilities-menu');
let abilitiesLoaded = false;

async function refreshReport() {
  try {
    const { results, supervised, delegated, parallel } = await api('/api/models');
    renderModelsReport(results || {}, supervised || {}, delegated || {}, parallel || {});
  } catch { /* ignore */ }
}

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
$('#model-btn').addEventListener('click', (e) => { e.stopPropagation(); modelMenu.classList.toggle('hidden'); });

$('#models-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  abilitiesMenu.classList.add('hidden');
  const opening = modelsMenu.classList.contains('hidden');
  modelsMenu.classList.toggle('hidden');
  if (opening) refreshReport();
});
$('#abilities-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  modelsMenu.classList.add('hidden');
  const opening = abilitiesMenu.classList.contains('hidden');
  abilitiesMenu.classList.toggle('hidden');
  if (opening && !abilitiesLoaded) { loadAbilities(); abilitiesLoaded = true; }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.model-picker')) modelMenu.classList.add('hidden');
  if (!e.target.closest('.dropdown')) {
    modelsMenu.classList.add('hidden');
    abilitiesMenu.classList.add('hidden');
  }
});

const chatInput = $('#chat-input');
const autoGrow = () => { chatInput.style.height = 'auto'; chatInput.style.height = `${chatInput.scrollHeight}px`; };
chatInput.addEventListener('input', autoGrow);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').requestSubmit(); }
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
document.querySelectorAll('.suggestion').forEach((b) =>
  b.addEventListener('click', () => { chatInput.value = b.textContent; autoGrow(); chatInput.focus(); })
);
