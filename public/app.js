// Dashboard frontend: a Gridstack grid of draggable/resizable cards (tiles +
// notes), with health, feature-request queue, models report, and agent chat.
const $ = (sel) => document.querySelector(sel);
const gridEl = $('#board');
const chatLog = $('#chat-log');

let state = { title: 'Dashboard', sections: [], notes: [], featureRequests: [] };
let healthCache = {};
let grid;
let rendering = false; // suppress layout-persist while we rebuild programmatically

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const jsonBody = (obj, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

async function loadDashboard() {
  state = await api('/api/dashboard');
  render();
}

function render() {
  $('#title').textContent = state.title;
  document.title = `${state.title} · Dashboard`;
  renderGrid();
  renderFR();
}

// ---- grid ----------------------------------------------------------------
function initGrid() {
  grid = GridStack.init(
    { column: 12, cellHeight: 92, margin: 8, float: false, handle: '.card-grip', animate: true },
    gridEl
  );
  grid.on('change', persistLayout);
}

let persistTimer = null;
function persistLayout() {
  if (rendering) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const items = grid.save(false).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    api('/api/layout', jsonBody({ items })).catch(() => {});
  }, 400);
}

function widgetEl(id, layout, defW, defH, innerHtml) {
  const el = document.createElement('div');
  el.className = 'grid-stack-item';
  el.setAttribute('gs-id', id);
  el.setAttribute('gs-w', layout.w || defW);
  el.setAttribute('gs-h', layout.h || defH);
  if (Number.isInteger(layout.x) && Number.isInteger(layout.y)) {
    el.setAttribute('gs-x', layout.x);
    el.setAttribute('gs-y', layout.y);
  } else {
    el.setAttribute('gs-auto-position', 'true');
  }
  el.innerHTML = `<div class="grid-stack-item-content">${innerHtml}</div>`;
  return el;
}

function tileInner(tile, sectionName) {
  const h = healthCache[tile.id];
  const dot = tile.health?.enabled ? `<span class="dot ${h?.status || 'unknown'}" title="${esc(healthTitle(h))}"></span>` : '';
  return `<div class="card tile-card" data-id="${tile.id}">
    <span class="card-grip" title="Drag">⠿</span>
    <button class="card-del" title="Delete tile">✕</button>
    <div class="tile-body" data-url="${esc(tile.url)}" title="${esc(tile.url)}">
      <span class="tile-icon">${esc(tile.icon || '🔗')}</span>
      <div class="tile-meta">
        <div class="tile-name">${esc(tile.name)}</div>
        ${tile.description ? `<div class="tile-desc">${esc(tile.description)}</div>` : ''}
      </div>
    </div>
    <div class="card-foot"><span class="tile-section">${esc(sectionName)}</span>${dot}</div>
  </div>`;
}

const NOTE_COLORS = ['#f6d365', '#a0e7a0', '#9bd0ff', '#ffb3c1', '#e0c3fc'];
function noteInner(note) {
  const swatches = NOTE_COLORS.map((c) => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join('');
  return `<div class="card note-card" data-id="${note.id}" style="background:${esc(note.color || NOTE_COLORS[0])}">
    <span class="card-grip" title="Drag">⠿</span>
    <button class="card-del" title="Delete note">✕</button>
    <textarea placeholder="Write a note…">${esc(note.text)}</textarea>
    <div class="card-foot"><div class="swatches">${swatches}</div></div>
  </div>`;
}

function renderGrid() {
  if (!grid) initGrid();
  rendering = true;
  grid.removeAll(true);

  const tileCount = state.sections.reduce((n, s) => n + s.tiles.length, 0);
  $('#empty-hint').classList.toggle('hidden', tileCount + state.notes.length > 0);

  for (const section of state.sections) {
    for (const tile of section.tiles) {
      const el = widgetEl(tile.id, tile.layout || {}, 3, 2, tileInner(tile, section.name));
      gridEl.appendChild(el);
      grid.makeWidget(el);
      wireTile(el, tile);
    }
  }
  for (const note of state.notes) {
    const el = widgetEl(note.id, note.layout || {}, 3, 3, noteInner(note));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireNote(el, note);
  }
  rendering = false;
}

function wireTile(el, tile) {
  el.querySelector('.tile-body').addEventListener('click', () => window.open(tile.url, '_blank', 'noopener'));
  el.querySelector('.card-del').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete tile "${tile.name}"?`)) return;
    await api(`/api/tiles/${tile.id}`, { method: 'DELETE' });
    await loadDashboard();
  });
}

function wireNote(el, note) {
  const ta = el.querySelector('textarea');
  ta.addEventListener('blur', () => { if (ta.value !== note.text) saveNote(note.id, { text: ta.value }); });
  el.querySelectorAll('.swatch').forEach((sw) =>
    sw.addEventListener('click', () => {
      el.querySelector('.note-card').style.background = sw.dataset.color;
      saveNote(note.id, { color: sw.dataset.color });
    })
  );
  el.querySelector('.card-del').addEventListener('click', async () => {
    if (!confirm('Delete this note?')) return;
    await api(`/api/notes/${note.id}`, { method: 'DELETE' });
    await loadDashboard();
  });
}

function healthTitle(h) {
  if (!h) return 'checking…';
  if (h.status === 'up') return `up · ${h.latencyMs}ms${h.code ? ` · ${h.code}` : ''}`;
  if (h.status === 'down') return `down · ${h.error || ''}`;
  return 'unknown';
}

async function loadHealth() {
  try {
    healthCache = await api('/api/health');
    gridEl.querySelectorAll('.tile-card').forEach((card) => {
      const h = healthCache[card.dataset.id];
      const dot = card.querySelector('.dot');
      if (dot && h) { dot.className = `dot ${h.status}`; dot.title = healthTitle(h); }
    });
  } catch { /* ignore */ }
}

// ---- add tile / note -----------------------------------------------------
async function addTile() {
  const name = prompt('Tile name:');
  if (!name) return;
  let url = prompt('Link URL (e.g. http://service.huis):');
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = 'http://' + url;
  try {
    let sectionId = state.sections[0]?.id;
    if (!sectionId) sectionId = (await api('/api/sections', jsonBody({ name: 'Services' }))).id;
    await api(`/api/sections/${sectionId}/tiles`, jsonBody({ name, url }));
    await loadDashboard();
  } catch (err) {
    alert('Could not add tile: ' + err.message);
  }
}

async function addNote() {
  await api('/api/notes', jsonBody({ text: '', color: NOTE_COLORS[state.notes.length % NOTE_COLORS.length] }));
  await loadDashboard();
  gridEl.querySelector('.grid-stack-item:last-child textarea')?.focus();
}

async function saveNote(id, patch) {
  try {
    const updated = await api(`/api/notes/${id}`, jsonBody(patch, 'PATCH'));
    const n = state.notes.find((x) => x.id === id);
    if (n) Object.assign(n, updated);
  } catch (err) { console.error(err); }
}

// ---- feature requests ----------------------------------------------------
const FR_STATUSES = ['open', 'planned', 'done', 'rejected'];
function renderFR() {
  const list = $('#fr-list');
  const frs = state.featureRequests;
  const open = frs.filter((f) => f.status === 'open').length;
  const badge = $('#fr-count');
  badge.textContent = open;
  badge.classList.toggle('hidden', open === 0);
  if (!frs.length) {
    list.innerHTML = '<p class="empty">No requests yet. Ask the assistant for something it can\'t do — it\'ll file one here.</p>';
    return;
  }
  list.innerHTML = frs
    .map((fr) => {
      const opts = FR_STATUSES.map((s) => `<option value="${s}"${s === fr.status ? ' selected' : ''}>${s}</option>`).join('');
      return `<div class="fr ${fr.status}" data-id="${fr.id}">
        <div class="fr-title">${esc(fr.title)}</div>
        ${fr.detail ? `<div class="fr-detail">${esc(fr.detail)}</div>` : ''}
        <div class="fr-meta"><span class="fr-by">by ${esc(fr.requestedBy)}</span><select>${opts}</select><button class="del" title="Delete">🗑</button></div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('.fr').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('select').addEventListener('change', (e) => api(`/api/feature-requests/${id}`, jsonBody({ status: e.target.value }, 'PATCH')).then(loadDashboard));
    el.querySelector('.del').addEventListener('click', () => api(`/api/feature-requests/${id}`, { method: 'DELETE' }).then(loadDashboard));
  });
}

// ---- models report + chat (unchanged behavior) ---------------------------
function fmtMs(ms) {
  if (!ms) return '';
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}
function speedTier(ms) {
  if (!ms) return '';
  if (ms < 2500) return '⚡';
  if (ms < 6000) return '🟢';
  if (ms < 12000) return '🟡';
  return '🐢';
}

async function loadModels() {
  const sel = $('#model-select');
  try {
    const { approved, details, results, supervised, delegated, parallel } = await api('/api/models');
    if (!approved.length) {
      sel.innerHTML = '<option value="">no validated models</option>';
      sel.disabled = true;
    } else {
      sel.disabled = false;
      sel.innerHTML = approved
        .map((m) => {
          const ms = details?.[m]?.msPerAction;
          const hint = ms ? ` ${speedTier(ms)} ~${fmtMs(ms)}/action` : '';
          return `<option value="${esc(m)}">${esc(m)}${esc(hint)}</option>`;
        })
        .join('');
    }
    renderModelsReport(results || {}, supervised || {}, delegated || {}, parallel || {});
  } catch {
    sel.innerHTML = '<option value="">offline</option>';
    sel.disabled = true;
  }
}

function renderSupervised(supervised) {
  const pairs = Object.values(supervised);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((s) => {
    const spd = s.supervisorAloneMs ? `~${fmtMs(s.msPerAction)} vs ${fmtMs(s.supervisorAloneMs)} solo (${s.speedup}×)` : `~${fmtMs(s.msPerAction)}`;
    return `<div class="mr-row ${s.useful ? 'ok' : 'bad'}"><span class="mr-badge">${s.useful ? '✓' : '✗'}</span><div class="mr-body"><div class="mr-name">${esc(s.worker)} <span class="mr-sub">▸ sup: ${esc(s.supervisor)}</span></div><div class="mr-sub">safe ${s.safetyPass ? '✓' : '✗'} · capable ${s.capabilityPass ? '✓' : '✗'} · ${spd} · ${s.totalBlocked} blocked</div></div></div>`;
  }).join('');
  return `<div class="mr-head">supervised pairings (worker ▸ supervisor)</div>${rows}`;
}
function renderDelegated(delegated) {
  const pairs = Object.values(delegated);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((d) => {
    const spd = d.orchestratorAloneMs ? `~${fmtMs(d.msPerAction)} vs ${fmtMs(d.orchestratorAloneMs)} solo (${d.speedup}×)` : `~${fmtMs(d.msPerAction)}`;
    return `<div class="mr-row ${d.useful ? 'ok' : 'bad'}"><span class="mr-badge">${d.useful ? '✓' : '✗'}</span><div class="mr-body"><div class="mr-name">${esc(d.orchestrator)} <span class="mr-sub">▸ sub: ${esc(d.subAgent)}</span></div><div class="mr-sub">safe ${d.safetyPass ? '✓' : '✗'} · capable ${d.capabilityPass ? '✓' : '✗'} · ${spd}</div></div></div>`;
  }).join('');
  return `<div class="mr-head">sub-agent delegation (orchestrator ▸ sub-agent)</div>${rows}`;
}
function renderParallel(parallel) {
  const pairs = Object.values(parallel);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs.map((p) => {
    const spd = p.orchestratorAloneMs ? `~${fmtMs(p.msPerAction)} vs ${fmtMs(p.orchestratorAloneMs)} solo (${p.speedup}×)` : `~${fmtMs(p.msPerAction)}`;
    return `<div class="mr-row ${p.useful ? 'ok' : 'bad'}"><span class="mr-badge">${p.useful ? '✓' : '✗'}</span><div class="mr-body"><div class="mr-name">${esc(p.orchestrator)} <span class="mr-sub">⇉ ${esc((p.subAgents || []).join(' + '))}</span></div><div class="mr-sub">safe ${p.safetyPass ? '✓' : '✗'} · capable ${p.capabilityPass ? '✓' : '✗'} · ${spd}</div>${p.temperatures ? `<div class="mr-sub">temps [${esc(p.temperatures.join(', '))}] · ctx ${esc(p.numCtx)}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="mr-head">parallel sub-agents (orchestrator ⇉ concurrent)</div>${rows}`;
}

function renderModelsReport(results, supervised = {}, delegated = {}, parallel = {}) {
  const menu = $('#models-menu');
  const entries = Object.entries(results);
  if (!entries.length) {
    menu.innerHTML = '<div class="mr-empty">No models validated yet.</div>' + renderSupervised(supervised) + renderDelegated(delegated) + renderParallel(parallel);
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
  menu.innerHTML = `<div class="mr-head">${approvedCount} approved · ${entries.length} tested</div>${rows}${renderSupervised(supervised)}${renderDelegated(delegated)}${renderParallel(parallel)}`;
}

const history = [];
function addMsg(role, text, trace) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (trace?.length) {
    const t = document.createElement('div');
    t.className = 'trace';
    t.innerHTML = trace.map((e) => `${e.ok ? '✓' : '✗'} <code>${esc(e.name)}</code>${e.ok ? '' : ` — ${esc(e.error)}`}`).join('<br>');
    el.appendChild(t);
  }
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

async function sendChat(text) {
  const model = $('#model-select').value;
  if (!model) return addMsg('error', 'No validated model selected.');
  history.push({ role: 'user', content: text });
  addMsg('user', text);
  const pending = addMsg('assistant', '…');
  const btn = $('#chat-form button');
  btn.disabled = true;
  try {
    const data = await api('/api/agent/chat', jsonBody({ model, messages: history }));
    pending.remove();
    addMsg('assistant', data.reply || '(no reply)', data.trace);
    history.push({ role: 'assistant', content: data.reply || '' });
    if (data.dashboard) { state = data.dashboard; render(); }
  } catch (err) {
    pending.remove();
    addMsg('error', err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---- wiring --------------------------------------------------------------
$('#chat-toggle').addEventListener('click', () => $('#chat').classList.toggle('hidden'));
$('#chat-close').addEventListener('click', () => $('#chat').classList.add('hidden'));
$('#fr-toggle').addEventListener('click', () => $('#fr-panel').classList.toggle('hidden'));
$('#fr-close').addEventListener('click', () => $('#fr-panel').classList.add('hidden'));
$('#note-add').addEventListener('click', addNote);
$('#tile-add').addEventListener('click', addTile);

let locked = false;
$('#edit-toggle').addEventListener('click', () => {
  locked = !locked;
  grid.setStatic(locked);
  $('#edit-toggle').textContent = locked ? '🔒 Locked' : '🔓 Edit';
  gridEl.classList.toggle('locked', locked);
});

const modelsMenu = $('#models-menu');
async function refreshReport() {
  try {
    const { results, supervised, delegated, parallel } = await api('/api/models');
    renderModelsReport(results || {}, supervised || {}, delegated || {}, parallel || {});
  } catch { /* ignore */ }
}
$('#models-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = modelsMenu.classList.contains('hidden');
  modelsMenu.classList.toggle('hidden');
  if (opening) refreshReport();
});
document.addEventListener('click', (e) => {
  if (!modelsMenu.classList.contains('hidden') && !e.target.closest('.dropdown')) modelsMenu.classList.add('hidden');
});

$('#fr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#fr-title').value.trim();
  if (!title) return;
  await api('/api/feature-requests', jsonBody({ title, detail: $('#fr-detail').value.trim(), requestedBy: 'you' }));
  $('#fr-title').value = '';
  $('#fr-detail').value = '';
  await loadDashboard();
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

function tick() {
  $('#clock').textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

loadDashboard();
loadModels();
loadHealth();
tick();
setInterval(tick, 30_000);
setInterval(loadHealth, 30_000);
