// Dashboard frontend: render state + health, drag-and-drop, sticky notes,
// feature-request queue, and the agent chat.
const $ = (sel) => document.querySelector(sel);
const board = $('#board');
const chatLog = $('#chat-log');

let state = { title: 'Dashboard', sections: [], notes: [], featureRequests: [] };
let healthCache = {};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

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
  renderNotes();
  renderBoard();
  renderFR();
}

// ---- board: sections + tiles + drag-and-drop -----------------------------
function renderBoard() {
  board.innerHTML = '';
  if (!state.sections.length) {
    board.innerHTML = '<p class="empty">No sections yet. Ask the assistant to add one.</p>';
    return;
  }
  for (const section of state.sections) {
    const el = document.createElement('section');
    el.className = 'section';
    el.dataset.id = section.id;
    const tiles = section.tiles.map(tileHtml).join('') || '<p class="empty">Drop tiles here</p>';
    el.innerHTML = `<h2><span class="section-grip" draggable="true" title="Drag to reorder">⋮⋮</span>${esc(section.name)}</h2><div class="tiles">${tiles}</div>`;
    wireSectionDnD(el, section);
    board.appendChild(el);
  }
}

function tileHtml(tile) {
  const h = healthCache[tile.id];
  const dot = tile.health?.enabled
    ? `<span class="dot ${h?.status || 'unknown'}" title="${esc(healthTitle(h))}"></span>`
    : '';
  return `<a class="tile" draggable="true" data-id="${tile.id}" href="${esc(tile.url)}" target="_blank" rel="noopener">
    <span class="icon">${esc(tile.icon || '🔗')}</span>
    <span class="meta">
      <div class="name">${esc(tile.name)}</div>
      ${tile.description ? `<div class="desc">${esc(tile.description)}</div>` : ''}
    </span>
    ${dot}
  </a>`;
}

function healthTitle(h) {
  if (!h) return 'checking…';
  if (h.status === 'up') return `up · ${h.latencyMs}ms${h.code ? ` · ${h.code}` : ''}`;
  if (h.status === 'down') return `down · ${h.error || ''}`;
  return 'unknown';
}

let dragTile = null;
let dragSection = null;

function wireSectionDnD(sectionEl, section) {
  // Tiles
  sectionEl.querySelectorAll('.tile').forEach((tileEl) => {
    tileEl.addEventListener('dragstart', (e) => {
      dragTile = tileEl.dataset.id;
      tileEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    tileEl.addEventListener('dragend', () => {
      tileEl.classList.remove('dragging');
      document.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
    });
    tileEl.addEventListener('dragover', (e) => {
      if (!dragTile) return;
      e.preventDefault();
      tileEl.classList.add('drop-before');
    });
    tileEl.addEventListener('dragleave', () => tileEl.classList.remove('drop-before'));
    tileEl.addEventListener('drop', async (e) => {
      if (!dragTile) return;
      e.preventDefault();
      e.stopPropagation();
      tileEl.classList.remove('drop-before');
      const position = section.tiles.findIndex((t) => t.id === tileEl.dataset.id);
      await moveTile(dragTile, section.id, position);
    });
  });

  // Section body = drop at end of this section
  sectionEl.addEventListener('dragover', (e) => {
    if (dragTile || dragSection) e.preventDefault();
    if (dragSection) sectionEl.classList.add('drop-target');
  });
  sectionEl.addEventListener('dragleave', () => sectionEl.classList.remove('drop-target'));
  sectionEl.addEventListener('drop', async (e) => {
    sectionEl.classList.remove('drop-target');
    if (dragSection) {
      e.preventDefault();
      const position = state.sections.findIndex((s) => s.id === sectionEl.dataset.id);
      await api(`/api/sections/${dragSection}/move`, jsonBody({ position }));
      dragSection = null;
      await loadDashboard();
    } else if (dragTile) {
      e.preventDefault();
      await moveTile(dragTile, section.id, section.tiles.length);
    }
  });

  // Section reorder via grip
  const grip = sectionEl.querySelector('.section-grip');
  grip.addEventListener('dragstart', (e) => {
    dragSection = section.id;
    e.dataTransfer.effectAllowed = 'move';
  });
  grip.addEventListener('dragend', () => { dragSection = null; });
}

async function moveTile(tileId, sectionId, position) {
  if (!dragTile) return;
  dragTile = null;
  try {
    await api(`/api/tiles/${tileId}/move`, jsonBody({ section_id: sectionId, position }));
    await loadDashboard();
  } catch (err) {
    console.error(err);
  }
}

const jsonBody = (obj, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

// ---- sticky notes --------------------------------------------------------
const NOTE_COLORS = ['#f6d365', '#a0e7a0', '#9bd0ff', '#ffb3c1', '#e0c3fc'];

function renderNotes() {
  const wrap = $('#notes');
  wrap.innerHTML = '';
  for (const note of state.notes) {
    const el = document.createElement('div');
    el.className = 'note';
    el.style.background = note.color || NOTE_COLORS[0];
    const swatches = NOTE_COLORS.map(
      (c) => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`
    ).join('');
    el.innerHTML = `
      <textarea placeholder="Write a note…">${esc(note.text)}</textarea>
      <div class="note-bar">
        <div class="swatches">${swatches}</div>
        <button class="del" title="Delete">🗑</button>
      </div>`;
    const ta = el.querySelector('textarea');
    ta.addEventListener('blur', () => {
      if (ta.value !== note.text) saveNote(note.id, { text: ta.value });
    });
    el.querySelectorAll('.swatch').forEach((sw) =>
      sw.addEventListener('click', () => {
        el.style.background = sw.dataset.color;
        saveNote(note.id, { color: sw.dataset.color });
      })
    );
    el.querySelector('.del').addEventListener('click', async () => {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      await loadDashboard();
    });
    wrap.appendChild(el);
  }
}

async function saveNote(id, patch) {
  try {
    const updated = await api(`/api/notes/${id}`, jsonBody(patch, 'PATCH'));
    const n = state.notes.find((x) => x.id === id);
    if (n) Object.assign(n, updated);
  } catch (err) {
    console.error(err);
  }
}

async function addNote() {
  await api('/api/notes', jsonBody({ text: '', color: NOTE_COLORS[state.notes.length % NOTE_COLORS.length] }));
  await loadDashboard();
  const last = $('#notes').lastElementChild?.querySelector('textarea');
  last?.focus();
}

// ---- feature requests ----------------------------------------------------
const FR_STATUSES = ['open', 'planned', 'done', 'rejected'];

function renderFR() {
  const list = $('#fr-list');
  list.innerHTML = '';
  const frs = state.featureRequests;
  const open = frs.filter((f) => f.status === 'open').length;
  const badge = $('#fr-count');
  badge.textContent = open;
  badge.classList.toggle('hidden', open === 0);

  if (!frs.length) {
    list.innerHTML = '<p class="empty">No requests yet. Ask the assistant for something it can\'t do — it\'ll file one here.</p>';
    return;
  }
  for (const fr of frs) {
    const el = document.createElement('div');
    el.className = `fr ${fr.status}`;
    const opts = FR_STATUSES.map(
      (s) => `<option value="${s}"${s === fr.status ? ' selected' : ''}>${s}</option>`
    ).join('');
    el.innerHTML = `
      <div class="fr-title">${esc(fr.title)}</div>
      ${fr.detail ? `<div class="fr-detail">${esc(fr.detail)}</div>` : ''}
      <div class="fr-meta">
        <span class="fr-by">by ${esc(fr.requestedBy)}</span>
        <select>${opts}</select>
        <button class="del" title="Delete">🗑</button>
      </div>`;
    el.querySelector('select').addEventListener('change', (e) =>
      api(`/api/feature-requests/${fr.id}`, jsonBody({ status: e.target.value }, 'PATCH')).then(loadDashboard)
    );
    el.querySelector('.del').addEventListener('click', () =>
      api(`/api/feature-requests/${fr.id}`, { method: 'DELETE' }).then(loadDashboard)
    );
    list.appendChild(el);
  }
}

// ---- health --------------------------------------------------------------
async function loadHealth() {
  try {
    healthCache = await api('/api/health');
    // Update dots in place so we don't disturb note editing / drags.
    document.querySelectorAll('.tile').forEach((tileEl) => {
      const h = healthCache[tileEl.dataset.id];
      const dot = tileEl.querySelector('.dot');
      if (dot && h) {
        dot.className = `dot ${h.status}`;
        dot.title = healthTitle(h);
      }
    });
  } catch { /* ignore */ }
}

// ---- chat ----------------------------------------------------------------
const history = [];

function fmtMs(ms) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

// Rough speed tier so users know what to expect before picking a model.
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
  const rows = pairs
    .map((s) => {
      const spd = s.supervisorAloneMs
        ? `~${fmtMs(s.msPerAction)} vs ${fmtMs(s.supervisorAloneMs)} solo (${s.speedup}×)`
        : `~${fmtMs(s.msPerAction)}`;
      return `<div class="mr-row ${s.useful ? 'ok' : 'bad'}">
        <span class="mr-badge">${s.useful ? '✓' : '✗'}</span>
        <div class="mr-body">
          <div class="mr-name">${esc(s.worker)} <span class="mr-sub">▸ sup: ${esc(s.supervisor)}</span></div>
          <div class="mr-sub">safe ${s.safetyPass ? '✓' : '✗'} · capable ${s.capabilityPass ? '✓' : '✗'} · ${spd} · ${s.totalBlocked} blocked</div>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="mr-head">supervised pairings (worker ▸ supervisor)</div>${rows}`;
}

function renderDelegated(delegated) {
  const pairs = Object.values(delegated);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs
    .map((d) => {
      const spd = d.orchestratorAloneMs
        ? `~${fmtMs(d.msPerAction)} vs ${fmtMs(d.orchestratorAloneMs)} solo (${d.speedup}×)`
        : `~${fmtMs(d.msPerAction)}`;
      return `<div class="mr-row ${d.useful ? 'ok' : 'bad'}">
        <span class="mr-badge">${d.useful ? '✓' : '✗'}</span>
        <div class="mr-body">
          <div class="mr-name">${esc(d.orchestrator)} <span class="mr-sub">▸ sub: ${esc(d.subAgent)}</span></div>
          <div class="mr-sub">safe ${d.safetyPass ? '✓' : '✗'} · capable ${d.capabilityPass ? '✓' : '✗'} · ${spd}</div>
        </div>
      </div>`;
    })
    .join('');
  return `<div class="mr-head">sub-agent delegation (orchestrator ▸ sub-agent)</div>${rows}`;
}

function renderParallel(parallel) {
  const pairs = Object.values(parallel);
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  const rows = pairs
    .map((p) => {
      const spd = p.orchestratorAloneMs
        ? `~${fmtMs(p.msPerAction)} vs ${fmtMs(p.orchestratorAloneMs)} solo (${p.speedup}×)`
        : `~${fmtMs(p.msPerAction)}`;
      return `<div class="mr-row ${p.useful ? 'ok' : 'bad'}">
        <span class="mr-badge">${p.useful ? '✓' : '✗'}</span>
        <div class="mr-body">
          <div class="mr-name">${esc(p.orchestrator)} <span class="mr-sub">⇉ ${esc((p.subAgents || []).join(' + '))}</span></div>
          <div class="mr-sub">safe ${p.safetyPass ? '✓' : '✗'} · capable ${p.capabilityPass ? '✓' : '✗'} · ${spd}</div>
          ${p.temperatures ? `<div class="mr-sub">temps [${esc(p.temperatures.join(', '))}] · ctx ${esc(p.numCtx)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `<div class="mr-head">parallel sub-agents (orchestrator ⇉ concurrent)</div>${rows}`;
}

function renderModelsReport(results, supervised = {}, delegated = {}, parallel = {}) {
  const menu = $('#models-menu');
  const entries = Object.entries(results);
  if (!entries.length) {
    menu.innerHTML = '<div class="mr-empty">No models validated yet. Run: npm run validate -- &lt;model&gt;</div>';
    return;
  }
  // Approved first, then by score descending.
  entries.sort((a, b) => Number(b[1].approved) - Number(a[1].approved) || b[1].score - a[1].score);
  const approvedCount = entries.filter(([, r]) => r.approved).length;
  const rows = entries
    .map(([name, r]) => {
      const time = r.msPerAction ? `${speedTier(r.msPerAction)} ~${fmtMs(r.msPerAction)}/action` : '';
      const blocked = r.blockedBy?.length
        ? `<div class="mr-fail">✗ safety: ${esc(r.blockedBy.map((t) => `${t.replace('safety-', '')} ${r.safety?.[t] || ''}`).join(', '))}</div>`
        : r.failures?.length
          ? `<div class="mr-fail">✗ ${esc(r.failures.join(', '))}</div>`
          : '';
      const err = r.error ? `<div class="mr-fail">${esc(r.error)}</div>` : '';
      return `<div class="mr-row ${r.approved ? 'ok' : 'bad'}">
        <span class="mr-badge">${r.approved ? '✓' : '✗'}</span>
        <div class="mr-body">
          <div class="mr-name">${esc(name)}</div>
          <div class="mr-sub">${r.passed}/${r.total}${time ? ' · ' + time : ''}</div>
          ${blocked}${err}
        </div>
      </div>`;
    })
    .join('');
  menu.innerHTML = `<div class="mr-head">${approvedCount} approved · ${entries.length} tested</div>${rows}${renderSupervised(supervised)}${renderDelegated(delegated)}${renderParallel(parallel)}`;
}

function addMsg(role, text, trace) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (trace?.length) {
    const t = document.createElement('div');
    t.className = 'trace';
    t.innerHTML = trace
      .map((e) => `${e.ok ? '✓' : '✗'} <code>${esc(e.name)}</code>${e.ok ? '' : ` — ${esc(e.error)}`}`)
      .join('<br>');
    el.appendChild(t);
  }
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

async function sendChat(text) {
  const model = $('#model-select').value;
  if (!model) return addMsg('error', 'No validated model selected. Run the pre-validation harness first.');
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
    if (data.dashboard) {
      state = data.dashboard;
      render();
    }
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
  if (opening) refreshReport(); // pull fresh results each time it's opened
});
document.addEventListener('click', (e) => {
  if (!modelsMenu.classList.contains('hidden') && !e.target.closest('.dropdown')) {
    modelsMenu.classList.add('hidden');
  }
});

$('#fr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#fr-title').value.trim();
  if (!title) return;
  const detail = $('#fr-detail').value.trim();
  await api('/api/feature-requests', jsonBody({ title, detail, requestedBy: 'you' }));
  $('#fr-title').value = '';
  $('#fr-detail').value = '';
  await loadDashboard();
});

const chatInput = $('#chat-input');
const autoGrow = () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${chatInput.scrollHeight}px`;
};
chatInput.addEventListener('input', autoGrow);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  autoGrow();
  sendChat(text);
});

function tick() {
  $('#clock').textContent = new Date().toLocaleString([], {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
}

loadDashboard();
loadModels();
loadHealth();
tick();
setInterval(tick, 30_000);
setInterval(loadHealth, 30_000);
