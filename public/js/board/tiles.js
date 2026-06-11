// Tile chips: template, health dots, click-to-open, bold toggle, delete, and
// drag-and-drop between sections.
import { $$, esc } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { FONT_WEIGHTS } from '../constants.js';
import { store, subscribe, loadDashboard } from '../state/store.js';
import { deleteWithUndo } from './editor.js';
import { openAiMenu } from './ai-menu.js';

function healthTitle(h) {
  if (!h) return 'checking…';
  if (h.status === 'up') return `up · ${h.latencyMs}ms${h.code ? ` · ${h.code}` : ''}`;
  if (h.status === 'down') return `down · ${h.error || ''}`;
  return 'unknown';
}

export function tileChip(tile) {
  const h = store.health[tile.id];
  const dot = tile.health?.enabled ? `<span class="dot ${h?.status || 'unknown'}" title="${esc(healthTitle(h))}"></span>` : '';
  return `<div class="tile-chip" draggable="true" data-id="${tile.id}" data-name="${esc(tile.name)}" data-url="${esc(tile.url)}" title="${esc(tile.url)}">
    <span class="tile-icon">${esc(tile.icon || '🔗')}</span>
    <span class="tile-meta"><span class="tile-name" style="font-weight:${tile.bold ? FONT_WEIGHTS.semiBold : FONT_WEIGHTS.normal}">${esc(tile.name)}</span>${tile.description ? `<span class="tile-desc">${esc(tile.description)}</span>` : ''}</span>
    ${dot}
    <button class="chip-ctl chip-bold${tile.bold ? ' on' : ''}" type="button" title="Bold label">B</button>
    <button class="chip-ctl chip-ai" type="button" title="Dashy: act on this tile">✦</button>
    <button class="chip-ctl chip-del" type="button" title="Delete tile">✕</button>
  </div>`;
}

// Wire every chip in a section card, plus the section's drop zone.
export function wireTileZone(el, section) {
  for (const chip of el.querySelectorAll('.tile-chip')) {
    chip.addEventListener('click', (e) => {
      if (!e.target.closest('.chip-ctl')) window.open(chip.dataset.url, '_blank', 'noopener');
    });
    chip.querySelector('.chip-bold').addEventListener('click', async (e) => {
      e.stopPropagation();
      const isBold = e.currentTarget.classList.contains('on');
      await api(`/api/tiles/${chip.dataset.id}`, jsonBody({ bold: !isBold }, 'PATCH'));
      await loadDashboard();
    });
    chip.querySelector('.chip-ai').addEventListener('click', (e) => {
      e.stopPropagation();
      openAiMenu({
        anchor: e.currentTarget,
        item: { type: 'tile', id: chip.dataset.id, label: chip.dataset.name },
        prompts: [
          'Write a description for this tile',
          'Move this tile to a better section',
          'Give this tile a fitting icon',
        ],
      });
    });
    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWithUndo(`/api/tiles/${chip.dataset.id}`, `Deleted tile "${chip.dataset.name}"`);
    });
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tile', chip.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => {
      // The drop may land in another section (or nowhere); sweep every zone.
      for (const z of document.querySelectorAll('.sec-tiles.drop')) z.classList.remove('drop');
      clearDropMarks(document);
    });
  }

  const zone = el.querySelector('.sec-tiles');
  // Tiles flow left-to-right in a wrapping grid, so the cursor's side of the
  // hovered chip decides insert-before vs insert-after in flow order.
  const insertAfter = (chip, e) => e.clientX > chip.getBoundingClientRect().left + chip.offsetWidth / 2;
  zone.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/tile')) return;
    e.preventDefault();
    zone.classList.add('drop');
    clearDropMarks(zone);
    const t = e.target.closest('.tile-chip');
    if (t) t.classList.add(insertAfter(t, e) ? 'drop-after' : 'drop-before');
  });
  zone.addEventListener('dragleave', () => { zone.classList.remove('drop'); clearDropMarks(zone); });
  zone.addEventListener('drop', async (e) => {
    zone.classList.remove('drop');
    clearDropMarks(zone);
    const tileId = e.dataTransfer.getData('text/tile');
    if (!tileId) return;
    e.preventDefault();
    const chips = [...zone.querySelectorAll('.tile-chip')];
    const target = e.target.closest('.tile-chip');
    let position; // undefined → append at the end (the pre-reorder behavior)
    if (target) {
      position = chips.indexOf(target) + (insertAfter(target, e) ? 1 : 0);
      const from = chips.findIndex((c) => c.dataset.id === tileId);
      // moveTile removes the tile before inserting, shifting later indexes.
      if (from !== -1 && from < position) position -= 1;
      if (from !== -1 && from === position) return; // dropped where it already sits
    }
    await api(`/api/tiles/${tileId}/move`, jsonBody({ section_id: section.id, position }));
    await loadDashboard();
  });
}

function clearDropMarks(root) {
  for (const c of root.querySelectorAll('.drop-before, .drop-after')) c.classList.remove('drop-before', 'drop-after');
}

// Patch health dots in place — no board re-render for a poll tick.
subscribe('health', (health) => {
  for (const chip of $$('#board .tile-chip')) {
    const h = health[chip.dataset.id];
    const dot = chip.querySelector('.dot');
    if (dot && h) { dot.className = `dot ${h.status}`; dot.title = healthTitle(h); }
  }
});
