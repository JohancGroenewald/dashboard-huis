// Global search: find tiles, sections, notes, and workspaces across ALL
// workspaces from the loaded state, and jump to a hit — switching to its
// workspace/board and briefly flashing the card. Press "/" to focus.
import { $, esc } from './util.js';
import { state } from './store.js';
import { showBoardWorkspace } from './workspace.js';

const input = $('#search-input');
const panel = $('#search-results');
const ICON = { tile: '🔗', section: '🗂️', note: '📝', workspace: '🪟' };
let current = [];

function find(q) {
  const tokens = q.toLowerCase().split(/\W+/).filter(Boolean);
  if (!tokens.length) return [];
  const wsName = (id) => state.workspaces.find((w) => w.id === id)?.name || '';
  const items = [];
  for (const s of state.sections) {
    items.push({ type: 'section', id: s.id, workspaceId: s.workspaceId, label: s.name, sub: `section · ${wsName(s.workspaceId)}`, hay: `section ${s.name} ${s.description || ''}` });
    for (const t of s.tiles) {
      items.push({ type: 'tile', id: t.id, workspaceId: s.workspaceId, label: t.name, sub: `tile in ${s.name}`, hay: `tile ${t.name} ${t.description || ''} ${t.url} ${s.name}` });
    }
  }
  for (const n of state.notes) {
    items.push({ type: 'note', id: n.id, workspaceId: n.workspaceId, label: (n.text || '(empty note)').slice(0, 60), sub: `note · ${wsName(n.workspaceId)}`, hay: `note ${n.text || ''}` });
  }
  for (const w of state.workspaces) items.push({ type: 'workspace', id: w.id, workspaceId: w.id, label: w.name, sub: 'workspace', hay: `workspace ${w.name}` });
  return items
    .map((it) => { let score = 0; const h = it.hay.toLowerCase(); for (const tk of tokens) if (h.includes(tk)) score++; return { ...it, score }; })
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function close() { panel.classList.add('hidden'); }

function render() {
  const q = input.value.trim();
  current = find(q);
  if (!q) return close();
  if (!current.length) { panel.innerHTML = '<div class="sr-empty">No matches</div>'; panel.classList.remove('hidden'); return; }
  panel.innerHTML = current
    .map((it, i) => `<button type="button" class="sr-item" data-i="${i}"><span class="sr-icon">${ICON[it.type] || '•'}</span><span class="sr-body"><span class="sr-label">${esc(it.label)}</span><span class="sr-sub">${esc(it.sub)}</span></span></button>`)
    .join('');
  panel.classList.remove('hidden');
  panel.querySelectorAll('.sr-item').forEach((b) => b.addEventListener('click', () => jump(current[Number(b.dataset.i)])));
}

async function jump(it) {
  if (!it) return;
  close();
  input.value = '';
  await showBoardWorkspace(it.workspaceId || state.activeWorkspaceId);
  if (it.type === 'workspace') return; // switching to it is the whole action
  setTimeout(() => {
    const sel = it.type === 'tile' ? `.tile-chip[data-id="${CSS.escape(it.id)}"]` : `[gs-id="${CSS.escape(it.id)}"]`;
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }, 90);
}

input.addEventListener('input', render);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  else if (e.key === 'Enter') { e.preventDefault(); jump(current[0]); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.topbar-search')) close(); });
document.addEventListener('keydown', (e) => {
  const t = document.activeElement;
  if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(t?.tagName) && !t?.isContentEditable) { e.preventDefault(); input.focus(); }
});
