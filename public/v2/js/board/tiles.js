// Tile chips: template, health dots, click-to-open, bold toggle, delete, and
// drag-and-drop between sections.
import { $$, esc } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { FONT_WEIGHTS } from '../constants.js';
import { store, subscribe, loadDashboard } from '../state/store.js';
import { deleteWithUndo } from './editor.js';

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
    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWithUndo(`/api/tiles/${chip.dataset.id}`, `Deleted tile "${chip.dataset.name}"`);
    });
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tile', chip.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  }

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

// Patch health dots in place — no board re-render for a poll tick.
subscribe('health', (health) => {
  for (const chip of $$('#board .tile-chip')) {
    const h = health[chip.dataset.id];
    const dot = chip.querySelector('.dot');
    if (dot && h) { dot.className = `dot ${h.status}`; dot.title = healthTitle(h); }
  }
});
