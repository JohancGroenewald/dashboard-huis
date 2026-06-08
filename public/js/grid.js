// Gridstack grid: section group cards + sticky-note cards, drag/resize with
// persisted layout, tile chips (click/delete/drag-between-sections), health.
import { $, api, jsonBody, esc, NOTE_COLORS } from './util.js';
import { state, onRender, loadDashboard } from './store.js';

const gridEl = $('#board');
let grid;
let rendering = false; // suppress layout-persist while we rebuild programmatically
let persistTimer = null;
let healthCache = {};
let locked = false;
// Auto-arrange = Gridstack gravity (float off): cards compact up to fill gaps.
let autoArrange = localStorage.getItem('dash-autoarrange') !== '0';

function arrangeLabel() {
  $('#arrange-toggle').textContent = `🧲 Arrange: ${autoArrange ? 'on' : 'off'}`;
}

function initGrid() {
  grid = GridStack.init(
    { column: 12, cellHeight: 92, margin: 8, float: !autoArrange, handle: '.card-grip', animate: true },
    gridEl
  );
  grid.on('change', persistLayout);
}

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

function healthTitle(h) {
  if (!h) return 'checking…';
  if (h.status === 'up') return `up · ${h.latencyMs}ms${h.code ? ` · ${h.code}` : ''}`;
  if (h.status === 'down') return `down · ${h.error || ''}`;
  return 'unknown';
}

function tileChip(tile) {
  const h = healthCache[tile.id];
  const dot = tile.health?.enabled ? `<span class="dot ${h?.status || 'unknown'}" title="${esc(healthTitle(h))}"></span>` : '';
  return `<div class="tile-chip" draggable="true" data-id="${tile.id}" data-url="${esc(tile.url)}" title="${esc(tile.url)}">
    <span class="tile-icon">${esc(tile.icon || '🔗')}</span>
    <span class="tile-meta"><span class="tile-name">${esc(tile.name)}</span>${tile.description ? `<span class="tile-desc">${esc(tile.description)}</span>` : ''}</span>
    ${dot}
    <button class="chip-del" title="Delete tile">✕</button>
  </div>`;
}

function sectionInner(section) {
  const tiles = section.tiles.map(tileChip).join('') || '<div class="sec-empty">No tiles — ＋ to add, or drop one here</div>';
  return `<div class="card section-card" data-id="${section.id}">
    <div class="sec-head">
      <span class="card-grip" title="Drag section">⠿</span>
      <span class="sec-name" title="Click to rename">${esc(section.name)}</span>
      <button class="sec-add" title="Add tile to this section">＋</button>
      <button class="sec-del" title="Delete section">✕</button>
    </div>
    <div class="sec-tiles" data-section="${section.id}">${tiles}</div>
  </div>`;
}

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

  $('#empty-hint').classList.toggle('hidden', state.sections.length + state.notes.length > 0);

  for (const section of state.sections) {
    const el = widgetEl(section.id, section.layout || {}, 4, 4, sectionInner(section));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireSection(el, section);
  }
  for (const note of state.notes) {
    const el = widgetEl(note.id, note.layout || {}, 3, 3, noteInner(note));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireNote(el, note);
  }
  rendering = false;
}

function wireSection(el, section) {
  el.querySelector('.sec-name').addEventListener('click', async () => {
    const name = prompt('Rename section:', section.name);
    if (name && name.trim() && name !== section.name) {
      await api(`/api/sections/${section.id}`, jsonBody({ name: name.trim() }, 'PATCH'));
      await loadDashboard();
    }
  });
  el.querySelector('.sec-add').addEventListener('click', () => addTileTo(section.id));
  el.querySelector('.sec-del').addEventListener('click', async () => {
    const n = section.tiles.length;
    if (!confirm(`Delete section "${section.name}"${n ? ` and its ${n} tile(s)` : ''}?`)) return;
    await api(`/api/sections/${section.id}`, { method: 'DELETE' });
    await loadDashboard();
  });

  el.querySelectorAll('.tile-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (!e.target.closest('.chip-del')) window.open(chip.dataset.url, '_blank', 'noopener');
    });
    chip.querySelector('.chip-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/tiles/${chip.dataset.id}`, { method: 'DELETE' });
      await loadDashboard();
    });
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tile', chip.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  const zone = el.querySelector('.sec-tiles');
  zone.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/tile')) { e.preventDefault(); zone.classList.add('drop'); }
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
  zone.addEventListener('drop', async (e) => {
    zone.classList.remove('drop');
    const tileId = e.dataTransfer.getData('text/tile');
    if (!tileId) return;
    e.preventDefault();
    await api(`/api/tiles/${tileId}/move`, jsonBody({ section_id: section.id }));
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

export async function loadHealth() {
  try {
    healthCache = await api('/api/health');
    gridEl.querySelectorAll('.tile-chip').forEach((chip) => {
      const h = healthCache[chip.dataset.id];
      const dot = chip.querySelector('.dot');
      if (dot && h) { dot.className = `dot ${h.status}`; dot.title = healthTitle(h); }
    });
  } catch { /* ignore */ }
}

async function addSection() {
  const name = prompt('New section name:');
  if (!name || !name.trim()) return;
  try {
    await api('/api/sections', jsonBody({ name: name.trim() }));
    await loadDashboard();
  } catch (err) {
    alert('Could not add section: ' + err.message);
  }
}

async function addTileTo(sectionId) {
  const name = prompt('Tile name:');
  if (!name) return;
  let url = prompt('Link URL (e.g. http://service.huis):');
  if (!url) return;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = 'http://' + url;
  try {
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

onRender(renderGrid);
arrangeLabel();
$('#section-add').addEventListener('click', addSection);
$('#note-add').addEventListener('click', addNote);
$('#arrange-toggle').addEventListener('click', () => {
  autoArrange = !autoArrange;
  localStorage.setItem('dash-autoarrange', autoArrange ? '1' : '0');
  arrangeLabel();
  if (!grid) return;
  grid.float(!autoArrange);
  if (autoArrange) { grid.compact(); persistLayout(); } // tidy now + save
});
$('#edit-toggle').addEventListener('click', () => {
  locked = !locked;
  grid.setStatic(locked);
  $('#edit-toggle').textContent = locked ? '🔒 Locked' : '🔓 Edit';
  gridEl.classList.toggle('locked', locked);
});
