// ⌘K: one bar for everything. Type to fuzzy-find board items (Jump to),
// run quick actions (Actions), or hand the text to the copilot (Ask —
// always the last row; Cmd+Enter forces it from anywhere).
import { $, esc, flashElement, toast } from './lib/dom.js';
import { api, jsonBody } from './lib/api.js';
import { openDialog } from './lib/dialog.js';
import { CMDK_UI, PULSE_UI } from './constants.js';
import { store, loadDashboard, applyDashboard } from './state/store.js';
import { setKeyHandler, pushEscLayer } from './keys.js';
import { showBoardWorkspace, showView } from './workspaces.js';
import { addTileTo } from './board/editor.js';
import { sendChat } from './dock/chat.js';
import { toggleDock } from './dock/dock.js';

const ICON = { tile: '🔗', section: '🗂️', note: '📝', workspace: '🪟' };
let backdrop;
let input;
let resultsEl;
let rows = [];
let sel = 0;
let popEsc = null;

// ---- fuzzy search over the loaded state (ported from the old search.js) ----
function findItems(q) {
  const tokens = q.toLowerCase().split(/\W+/).filter(Boolean);
  if (!tokens.length) return [];
  const d = store.dashboard;
  const wsName = (id) => d.workspaces.find((w) => w.id === id)?.name || '';
  const items = [];
  for (const s of d.sections) {
    items.push({ type: 'section', id: s.id, workspaceId: s.workspaceId, label: s.name, sub: `section · ${wsName(s.workspaceId)}`, hay: `section ${s.name} ${s.description || ''}` });
    for (const t of s.tiles) {
      items.push({ type: 'tile', id: t.id, workspaceId: s.workspaceId, label: t.name, sub: `tile in ${s.name}`, hay: `tile ${t.name} ${t.description || ''} ${t.url} ${s.name}` });
    }
  }
  for (const n of d.notes) {
    items.push({ type: 'note', id: n.id, workspaceId: n.workspaceId, label: (n.text || '(empty note)').slice(0, CMDK_UI.noteLabelPreviewChars), sub: `note · ${wsName(n.workspaceId)}`, hay: `note ${n.text || ''}` });
  }
  for (const w of d.workspaces) items.push({ type: 'workspace', id: w.id, workspaceId: w.id, label: w.name, sub: 'workspace', hay: `workspace ${w.name}` });
  return items
    .map((it) => { let score = 0; const h = it.hay.toLowerCase(); for (const tk of tokens) if (h.includes(tk)) score++; return { ...it, score }; })
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CMDK_UI.resultLimit);
}

async function jump(it) {
  await showBoardWorkspace(it.workspaceId || store.dashboard.activeWorkspaceId);
  if (it.type === 'workspace') return;
  setTimeout(() => {
    const safe = CSS.escape(it.id);
    const el = document.querySelector(it.type === 'tile' ? `.tile-chip[data-id="${safe}"]` : `#board [gs-id="${safe}"]`);
    if (el) flashElement(el);
  }, PULSE_UI.jumpDelayMs);
}

// ---- quick actions ----
function buildActions() {
  const d = store.dashboard;
  const activeWs = d.activeWorkspaceId;
  const actions = [
    {
      icon: '🗂️', label: 'New section…', hay: 'new add section create',
      run: async () => {
        const v = await openDialog({ title: 'New section', fields: [{ name: 'name', placeholder: 'Name' }], submitLabel: 'Create' });
        if (!v?.name) return;
        await api('/api/sections', jsonBody({ name: v.name }));
        await loadDashboard();
      },
    },
    {
      icon: '📝', label: 'New note', hay: 'new add note sticky create',
      run: async () => { await api('/api/notes', jsonBody({ text: '' })); await loadDashboard(); },
    },
    ...d.sections.filter((s) => s.workspaceId === activeWs).map((s) => ({
      icon: '🔗', label: `New tile in "${s.name}"…`, hay: `new add tile link ${s.name}`,
      run: () => addTileTo(s.id),
    })),
    ...d.workspaces.map((w) => ({
      icon: '🪟', label: `Switch to "${w.name}"`, hay: `switch go workspace ${w.name}`,
      run: () => showBoardWorkspace(w.id),
    })),
    {
      icon: '↶', label: 'Undo', hay: 'undo revert',
      run: async () => { const r = await api('/api/undo', { method: 'POST' }); applyDashboard(r.dashboard); },
    },
    {
      icon: '↷', label: 'Redo', hay: 'redo',
      run: async () => { const r = await api('/api/redo', { method: 'POST' }); applyDashboard(r.dashboard); },
    },
    {
      icon: '⊟', label: 'Collapse all sections', hay: 'collapse fold all sections',
      run: async () => applyDashboard(await api('/api/sections/collapse', jsonBody({ collapsed: true }))),
    },
    {
      icon: '⊞', label: 'Expand all sections', hay: 'expand unfold all sections',
      run: async () => applyDashboard(await api('/api/sections/collapse', jsonBody({ collapsed: false }))),
    },
    { icon: '✦', label: 'Toggle Dashy', sub: '⌘J', hay: 'dashy copilot dock chat assistant toggle', run: () => toggleDock() },
    { icon: '🧪', label: 'Open Models', hay: 'models validation open view', run: () => showView('models') },
    { icon: '🛠️', label: 'Open Abilities', hay: 'abilities tools open view', run: () => showView('abilities') },
    { icon: '🗒️', label: 'Open Requests', hay: 'requests features open view', run: () => showView('requests') },
    { icon: '🧾', label: 'Open Logs', hay: 'logs conversations open view', run: () => showView('logs') },
    { icon: '🎬', label: 'Open Replay', hay: 'replay playback recording runs open view', run: () => showView('replay') },
    { icon: '📜', label: 'Open Prompts', hay: 'prompts system prompt edit review open view', run: () => showView('prompts') },
  ];
  return actions;
}

function matchActions(q) {
  const all = buildActions();
  if (!q) return all.slice(0, 6);
  const tokens = q.toLowerCase().split(/\W+/).filter(Boolean);
  return all
    .map((a) => { let score = 0; const h = `${a.label} ${a.hay}`.toLowerCase(); for (const tk of tokens) if (h.includes(tk)) score++; return { ...a, score }; })
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// ---- rendering ----
function render() {
  const q = input.value.trim();
  const jumps = q ? findItems(q) : [];
  const actions = matchActions(q);

  rows = [
    ...jumps.map((it) => ({ icon: ICON[it.type] || '•', label: it.label, sub: it.sub, run: () => jump(it) })),
    ...actions,
    {
      icon: '✦',
      label: q ? `Ask Dashy: “${q}”` : 'Ask Dashy…',
      sub: '⌘↵',
      ask: true,
      run: () => (q ? sendChat(q) : toggleDock()),
    },
  ];
  sel = Math.min(sel, rows.length - 1);

  let html = '';
  rows.forEach((r, i) => {
    if (i === 0 && jumps.length) html += '<div class="cmdk-group">Jump to</div>';
    if (i === jumps.length && actions.length) html += '<div class="cmdk-group">Actions</div>';
    html += `<button type="button" class="cmdk-row${r.ask ? ' ask' : ''}${i === sel ? ' sel' : ''}" data-i="${i}">
      <span class="ck-icon">${r.icon}</span><span class="ck-label">${esc(r.label)}</span>${r.sub ? `<span class="ck-sub">${esc(r.sub)}</span>` : ''}
    </button>`;
  });

  resultsEl.innerHTML = html;
  for (const b of resultsEl.querySelectorAll('.cmdk-row')) {
    b.addEventListener('click', () => runRow(Number(b.dataset.i)));
    b.addEventListener('pointermove', () => { sel = Number(b.dataset.i); paintSel(); });
  }
}

function paintSel() {
  resultsEl.querySelectorAll('.cmdk-row').forEach((b, i) => b.classList.toggle('sel', i === sel));
  resultsEl.querySelector('.cmdk-row.sel')?.scrollIntoView({ block: 'nearest' });
}

async function runRow(i) {
  const row = rows[i];
  if (!row) return;
  closeCmdk();
  try { await row.run(); } catch (err) { toast(err.message, { error: true }); }
}

// ---- open / close ----
const dragOffset = { x: 0, y: 0 };

export function openCmdk() {
  backdrop.classList.remove('hidden');
  input.value = '';
  sel = 0;
  // A fresh open re-centres the box.
  dragOffset.x = 0;
  dragOffset.y = 0;
  $('.cmdk-panel').style.transform = '';
  render();
  input.focus();
  popEsc = pushEscLayer(closeCmdk);
}

export function closeCmdk() {
  backdrop.classList.add('hidden');
  popEsc?.();
  popEsc = null;
}

export function initCmdk() {
  backdrop = $('#cmdk');
  input = $('#cmdk-input');
  resultsEl = $('#cmdk-results');

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, rows.length - 1); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paintSel(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runRow(rows.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); runRow(sel); }
  });
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) closeCmdk(); });
  $('#cmdk-esc').addEventListener('click', () => closeCmdk());

  // Drag the box by its input row (anywhere but the input itself), so it can
  // be moved off whatever it's covering. Re-centres on the next open.
  const panel = $('.cmdk-panel');
  const dragRow = $('.cmdk-input-row');
  let drag = null;
  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    const m = 8;
    const dx = Math.min(Math.max(drag.rect.left + (e.clientX - drag.x), m), window.innerWidth - drag.rect.width - m) - drag.rect.left;
    const dy = Math.min(Math.max(drag.rect.top + (e.clientY - drag.y), m), window.innerHeight - drag.rect.height - m) - drag.rect.top;
    dragOffset.x = drag.base.x + dx;
    dragOffset.y = drag.base.y + dy;
    panel.style.transform = `translate(${dragOffset.x}px, ${dragOffset.y}px)`;
  };
  const onUp = () => {
    if (!drag) return;
    drag = null;
    panel.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  dragRow.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === input || e.target.closest('.cmdk-esc')) return;
    drag = { x: e.clientX, y: e.clientY, rect: panel.getBoundingClientRect(), base: { ...dragOffset } };
    panel.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  $('#cmdk-pill').addEventListener('click', openCmdk);
  setKeyHandler('cmdk', openCmdk);
}
