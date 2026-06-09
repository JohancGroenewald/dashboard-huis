// Gridstack grid: section group cards + sticky-note cards, drag/resize with
// persisted layout, tile chips (click/delete/drag-between-sections), health.
import { $, api, jsonBody, esc, NOTE_COLORS } from './util.js';
import { state, onRender, loadDashboard, setState } from './store.js';

const gridEl = $('#board');
const COLS = 12;
// Grid row height in px — adjustable ("Grid size" in the Layout menu). The
// overlay and Gridstack share this value so the guides stay exact.
let cellH = Math.min(160, Math.max(56, Number(localStorage.getItem('dash-cellh')) || 92));
let grid;
let rendering = false; // suppress layout-persist while we rebuild programmatically
let persistTimer = null;
let healthCache = {};
let locked = false;
// Auto-arrange = Gridstack gravity (float off): cards compact up to fill gaps.
let autoArrange = localStorage.getItem('dash-autoarrange') !== '0';
let showGrid = localStorage.getItem('dash-showgrid') === '1';

function arrangeLabel() {
  $('#arrange-toggle').textContent = `🧲 Arrange: ${autoArrange ? 'on' : 'off'}`;
}

function initGrid() {
  grid = GridStack.init(
    { column: COLS, cellHeight: cellH, margin: 8, float: !autoArrange, handle: '.card-grip', animate: true },
    gridEl
  );
  grid.on('change', persistLayout);
}

// Size the grid-guides overlay to the live cell size so the lines mark the exact
// cells the cards snap to (column width = grid width / 12; row = cellHeight).
function updateGridOverlay() {
  if (!grid || !showGrid) return;
  gridEl.style.backgroundSize = `${gridEl.clientWidth / COLS}px ${cellH}px`;
}
window.addEventListener('resize', updateGridOverlay);

function persistLayout() {
  if (rendering) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const items = grid.save(false).map((n) => {
      // A collapsed section is rendered at h=1; keep its real (expanded) height
      // so it restores correctly when expanded.
      const sec = state.sections.find((s) => s.id === n.id);
      return { id: n.id, x: n.x, y: n.y, w: n.w, h: sec?.collapsed ? (sec.layout?.h || 4) : n.h };
    });
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
  return `<div class="tile-chip" draggable="true" data-id="${tile.id}" data-name="${esc(tile.name)}" data-url="${esc(tile.url)}" title="${esc(tile.url)}">
    <span class="tile-icon">${esc(tile.icon || '🔗')}</span>
    <span class="tile-meta"><span class="tile-name" style="font-weight:${tile.bold ? 650 : 400}">${esc(tile.name)}</span>${tile.description ? `<span class="tile-desc">${esc(tile.description)}</span>` : ''}</span>
    ${dot}
    <button class="chip-bold${tile.bold ? ' on' : ''}" title="Bold label">B</button>
    <button class="chip-attach" title="Attach to chat">📎</button>
    <button class="chip-del" title="Delete tile">✕</button>
  </div>`;
}

// Section card colour palettes ('' = clear back to the theme default).
const SEC_BG = ['', '#1a2233', '#16241a', '#2a1f2e', '#2a2418', '#1a2628'];
const SEC_BORDER = ['', '#4c8dff', '#3fb950', '#f85149', '#d29922', '#a371f7'];
const SEC_HEADING = ['', '#e8eef5', '#7aa9ff', '#69d28a', '#f0b429', '#ff9580'];
function swatchRow(label, prop, colors, current) {
  const sw = colors
    .map((c) => {
      const sel = (current || '') === c ? ' sel' : '';
      return c
        ? `<span class="sty-swatch${sel}" data-prop="${prop}" data-color="${c}" style="background:${c}" title="${c}"></span>`
        : `<span class="sty-swatch clear${sel}" data-prop="${prop}" data-color="" title="Default"></span>`;
    })
    .join('');
  return `<div class="sty-row"><span class="sty-label">${label}</span>${sw}</div>`;
}

function sectionInner(section) {
  const tiles = section.tiles.map(tileChip).join('') || '<div class="sec-empty">No tiles — ＋ to add, or drop one here</div>';
  const n = section.tiles.length;
  const cardStyle = [
    section.color ? `background:${esc(section.color)}` : '',
    section.borderColor ? `border-color:${esc(section.borderColor)}` : '',
  ].filter(Boolean).join(';');
  const nameStyle = ` style="font-weight:${section.bold ? 650 : 400}${section.headingColor ? `;color:${esc(section.headingColor)}` : ''}"`;
  const desc = section.description
    ? `<div class="sec-desc" title="Click to edit description">${esc(section.description)}</div>`
    : '<div class="sec-desc empty" title="Add a description">＋ description</div>';
  return `<div class="card section-card${section.collapsed ? ' collapsed' : ''}" data-id="${section.id}"${cardStyle ? ` style="${cardStyle}"` : ''}>
    <div class="sec-head">
      <button class="sec-collapse" title="${section.collapsed ? 'Expand' : 'Collapse'} section">${section.collapsed ? '▸' : '▾'}</button>
      <span class="card-grip" title="Drag section">⠿</span>
      <span class="sec-name"${nameStyle} title="Click to rename">${esc(section.name)}</span>
      ${section.collapsed && n ? `<span class="sec-count" title="${n} tile(s)">${n}</span>` : ''}
      <button class="sec-style-btn" title="Card colours">🎨</button>
      <button class="sec-attach" title="Attach to chat">📎</button>
      <button class="sec-add" title="Add tile to this section">＋</button>
      <button class="sec-del" title="Delete section">✕</button>
    </div>
    ${desc}
    <div class="sec-style hidden">
      ${swatchRow('Fill', 'color', SEC_BG, section.color)}
      ${swatchRow('Outline', 'borderColor', SEC_BORDER, section.borderColor)}
      ${swatchRow('Heading', 'headingColor', SEC_HEADING, section.headingColor)}
      <label class="sty-toggle"><input type="checkbox" class="sec-bold-chk"${section.bold ? ' checked' : ''}> Bold heading</label>
    </div>
    <div class="sec-tiles" data-section="${section.id}">${tiles}</div>
  </div>`;
}

const NOTE_TEXT_COLORS = ['#2a2300', '#000000', '#ffffff', '#1d4ed8', '#b91c1c'];
function noteInner(note) {
  const bg = NOTE_COLORS.map((c) => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join('');
  const tx = NOTE_TEXT_COLORS.map((c) => `<span class="tswatch" data-textcolor="${c}" style="color:${c}">A</span>`).join('');
  const style = `background:${esc(note.color || NOTE_COLORS[0])}${note.textColor ? `;color:${esc(note.textColor)}` : ''}${note.bold ? ';font-weight:700' : ''}`;
  return `<div class="card note-card" data-id="${note.id}" style="${style}">
    <span class="card-grip" title="Drag">⠿</span>
    <textarea placeholder="Write a note…">${esc(note.text)}</textarea>
    <div class="note-bar">
      <div class="swatches">${bg}</div>
      <div class="tswatches" title="Text colour">${tx}</div>
      <span class="note-spacer"></span>
      <button class="note-bold${note.bold ? ' on' : ''}" title="Bold text">B</button>
      <button class="note-attach" title="Attach to chat">📎</button>
      <button class="note-hide" title="Hide note">🙈</button>
      <button class="note-del" title="Delete note">✕</button>
    </div>
  </div>`;
}

function renderGrid() {
  if (!grid) initGrid();
  rendering = true;
  grid.removeAll(true);

  // Only the active workspace's cards are on the board.
  const ws = state.activeWorkspaceId;
  const sections = state.sections.filter((s) => s.workspaceId === ws);
  const notes = state.notes.filter((n) => n.workspaceId === ws);
  $('#empty-hint').classList.toggle('hidden', sections.length + notes.length > 0);

  const cab = $('#collapse-all');
  if (cab) {
    const allCollapsed = sections.length > 0 && sections.every((s) => s.collapsed);
    cab.textContent = allCollapsed ? '⊞ Expand all' : '⊟ Collapse all';
    cab.classList.toggle('hidden', sections.length === 0);
  }

  for (const section of sections) {
    // Collapsed sections render at a single header row; their stored layout.h
    // (the expanded height) is preserved by persistLayout for when they reopen.
    const layout = section.collapsed ? { ...(section.layout || {}), h: 1 } : (section.layout || {});
    const el = widgetEl(section.id, layout, 4, 4, sectionInner(section));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireSection(el, section);
  }
  for (const note of notes) {
    if (note.hidden) {
      // Hidden notes leave a faint, dashed-outline placeholder (with the
      // see-no-evil monkey) — click to restore.
      const el = widgetEl(note.id, note.layout || {}, 3, 2, '<div class="note-ghost" title="Hidden note — click to show">🙈</div>');
      gridEl.appendChild(el);
      grid.makeWidget(el);
      el.querySelector('.note-ghost').addEventListener('click', async () => {
        await api(`/api/notes/${note.id}`, jsonBody({ hidden: false }, 'PATCH'));
        await loadDashboard();
      });
      continue;
    }
    const el = widgetEl(note.id, note.layout || {}, 3, 3, noteInner(note));
    gridEl.appendChild(el);
    grid.makeWidget(el);
    wireNote(el, note);
  }
  rendering = false;
  updateGridOverlay();
}

// Attach an item to the chat composer (chat.js listens).
function attachItem(type, id, label) {
  document.dispatchEvent(new CustomEvent('attach-item', { detail: { type, id, label: String(label || type).slice(0, 40) } }));
}


function wireSection(el, section) {
  el.querySelector('.sec-collapse').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api(`/api/sections/${section.id}/collapse`, jsonBody({ collapsed: !section.collapsed }));
    await loadDashboard();
  });
  el.querySelector('.sec-desc').addEventListener('click', async () => {
    const cur = section.description || '';
    const val = prompt('Section description:', cur);
    if (val === null || val === cur) return;
    await api(`/api/sections/${section.id}`, jsonBody({ description: val }, 'PATCH'));
    await loadDashboard();
  });
  const stylePanel = el.querySelector('.sec-style');
  el.querySelector('.sec-style-btn').addEventListener('click', (e) => { e.stopPropagation(); stylePanel.classList.toggle('hidden'); });
  el.querySelectorAll('.sty-swatch').forEach((sw) =>
    sw.addEventListener('click', async () => {
      await api(`/api/sections/${section.id}`, jsonBody({ [sw.dataset.prop]: sw.dataset.color }, 'PATCH'));
      await loadDashboard();
    })
  );
  el.querySelector('.sec-bold-chk').addEventListener('change', async (e) => {
    await api(`/api/sections/${section.id}`, jsonBody({ bold: e.target.checked }, 'PATCH'));
    await loadDashboard();
  });
  el.querySelector('.sec-name').addEventListener('click', async () => {
    const name = prompt('Rename section:', section.name);
    if (name && name.trim() && name !== section.name) {
      await api(`/api/sections/${section.id}`, jsonBody({ name: name.trim() }, 'PATCH'));
      await loadDashboard();
    }
  });
  el.querySelector('.sec-add').addEventListener('click', () => addTileTo(section.id));
  el.querySelector('.sec-attach').addEventListener('click', () => attachItem('section', section.id, section.name));
  el.querySelector('.sec-del').addEventListener('click', async () => {
    const n = section.tiles.length;
    if (!confirm(`Delete section "${section.name}"${n ? ` and its ${n} tile(s)` : ''}?`)) return;
    await api(`/api/sections/${section.id}`, { method: 'DELETE' });
    await loadDashboard();
  });

  el.querySelectorAll('.tile-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (!e.target.closest('.chip-del') && !e.target.closest('.chip-attach') && !e.target.closest('.chip-bold')) window.open(chip.dataset.url, '_blank', 'noopener');
    });
    chip.querySelector('.chip-bold').addEventListener('click', async (e) => {
      e.stopPropagation();
      const isBold = e.currentTarget.classList.contains('on');
      await api(`/api/tiles/${chip.dataset.id}`, jsonBody({ bold: !isBold }, 'PATCH'));
      await loadDashboard();
    });
    chip.querySelector('.chip-attach').addEventListener('click', (e) => {
      e.stopPropagation();
      attachItem('tile', chip.dataset.id, chip.dataset.name);
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
  const card = el.querySelector('.note-card');
  const ta = el.querySelector('textarea');
  ta.addEventListener('blur', () => { if (ta.value !== note.text) saveNote(note.id, { text: ta.value }); });
  el.querySelectorAll('.swatch').forEach((sw) =>
    sw.addEventListener('click', () => { card.style.background = sw.dataset.color; saveNote(note.id, { color: sw.dataset.color }); })
  );
  el.querySelectorAll('.tswatch').forEach((sw) =>
    sw.addEventListener('click', () => { card.style.color = sw.dataset.textcolor; saveNote(note.id, { textColor: sw.dataset.textcolor }); })
  );
  el.querySelector('.note-bold').addEventListener('click', (e) => {
    note.bold = !note.bold;
    card.style.fontWeight = note.bold ? '700' : '';
    e.currentTarget.classList.toggle('on', note.bold);
    saveNote(note.id, { bold: note.bold });
  });
  el.querySelector('.note-attach').addEventListener('click', () => attachItem('note', note.id, note.text || 'note'));
  el.querySelector('.note-hide').addEventListener('click', async () => {
    await api(`/api/notes/${note.id}`, jsonBody({ hidden: true }, 'PATCH'));
    await loadDashboard();
  });
  el.querySelector('.note-del').addEventListener('click', async () => {
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

async function saveNote(id, patch) {
  try {
    const updated = await api(`/api/notes/${id}`, jsonBody(patch, 'PATCH'));
    const n = state.notes.find((x) => x.id === id);
    if (n) Object.assign(n, updated);
  } catch (err) { console.error(err); }
}

// ---- undo / redo ----
async function history(path) {
  try {
    const { dashboard, canUndo, canRedo } = await api(path, { method: 'POST' });
    setState(dashboard);
    $('#undo-btn').disabled = !canUndo;
    $('#redo-btn').disabled = !canRedo;
  } catch (err) { console.error(err); }
}
$('#undo-btn').addEventListener('click', () => history('/api/undo'));
$('#redo-btn').addEventListener('click', () => history('/api/redo'));
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // let inputs do their own undo
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); history('/api/undo'); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history('/api/redo'); }
});

onRender(renderGrid);
arrangeLabel();
// Collapse all if any section is open, otherwise expand all (active workspace).
$('#collapse-all').addEventListener('click', async () => {
  const secs = state.sections.filter((s) => s.workspaceId === state.activeWorkspaceId);
  const anyExpanded = secs.some((s) => !s.collapsed);
  setState(await api('/api/sections/collapse', jsonBody({ collapsed: anyExpanded })));
});
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

// Grid-guides overlay. Cards always snap to the grid; this just shows it.
function snapLabel() {
  $('#snap-toggle').textContent = `⊞ Grid: ${showGrid ? 'on' : 'off'}`;
  gridEl.classList.toggle('show-grid', showGrid);
  updateGridOverlay();
}
$('#snap-toggle').addEventListener('click', () => {
  showGrid = !showGrid;
  localStorage.setItem('dash-showgrid', showGrid ? '1' : '0');
  snapLabel();
});
snapLabel();

// Grid size: adjust the row height (cards keep their cell counts, so they grow
// or shrink). Applied live to Gridstack + the overlay, and persisted.
function applyCellH() {
  $('#grid-size-val').textContent = String(cellH);
  if (grid) grid.cellHeight(cellH);
  updateGridOverlay();
}
$('#grid-smaller').addEventListener('click', () => { cellH = Math.max(56, cellH - 12); localStorage.setItem('dash-cellh', cellH); applyCellH(); });
$('#grid-bigger').addEventListener('click', () => { cellH = Math.min(160, cellH + 12); localStorage.setItem('dash-cellh', cellH); applyCellH(); });
applyCellH();

// Layout dropdown: holds Collapse all / Grid / Arrange / Edit. Stays open while
// you flip toggles; closes on an outside click.
const layoutMenu = $('#layout-menu');
$('#layout-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelectorAll('.topbar .dropdown-menu').forEach((m) => { if (m !== layoutMenu) m.classList.add('hidden'); });
  layoutMenu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) layoutMenu.classList.add('hidden'); });
