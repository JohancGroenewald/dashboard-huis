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
      draggedChip = chip;
      dragFrom = { sectionId: section.id, index: [...el.querySelectorAll('.tile-chip')].indexOf(chip) };
      getSlot().style.height = `${chip.offsetHeight}px`;
      // Defer the dimming so the browser's drag ghost snapshots at full opacity.
      requestAnimationFrame(() => chip.classList.add('dragging'));
    });
    chip.addEventListener('dragend', () => {
      // Fires for drop and cancel alike; the slot is preview-only, so cleanup
      // is just removing it — the real order never changed until the drop.
      chip.classList.remove('dragging');
      endDragPreview();
      draggedChip = null;
      dragFrom = null;
    });
  }

  const zone = el.querySelector('.sec-tiles');
  // A dashed slot element travels through the grid as the drop preview; the
  // dragged chip itself never moves (re-parenting the source aborts a native
  // drag), it just dims in place until the drop commits.
  zone.addEventListener('dragover', (e) => {
    if (!draggedChip || !e.dataTransfer.types.includes('text/tile')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drop');
    const s = getSlot();
    const t = e.target.closest('.tile-chip');
    let ref;
    if (t === draggedChip) ref = t; // hovering the source: slot takes its place
    else if (t) {
      // Tiles flow left-to-right: the cursor's side of the chip picks the slot.
      ref = e.clientX > t.getBoundingClientRect().left + t.offsetWidth / 2 ? t.nextElementSibling : t;
    } else {
      // Over empty zone space (or the slot itself): only append when past the
      // last chip, so crossing grid gaps doesn't bounce the slot to the end.
      const chips = [...zone.querySelectorAll('.tile-chip')].filter((c) => c !== draggedChip);
      const last = chips[chips.length - 1];
      if (last && e.clientY < last.getBoundingClientRect().bottom) return;
      ref = null;
    }
    if (ref === s) return;
    if (s.parentElement === zone && s.nextElementSibling === ref) return; // already there
    animateReflow([zone, s.parentElement], () => zone.insertBefore(s, ref));
  });
  zone.addEventListener('dragleave', (e) => {
    // Children fire dragleave too as the cursor crosses chips; only clear the
    // outline when the cursor truly exits the zone.
    if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('drop');
  });
  zone.addEventListener('drop', async (e) => {
    if (!draggedChip) return;
    e.preventDefault();
    const s = getSlot();
    // Position = chips before the slot, minus the dragged one — which is the
    // insertion index after moveTile's remove-then-insert.
    const kids = [...zone.children];
    const slotIdx = kids.indexOf(s);
    const position = slotIdx === -1
      ? undefined // dropped without a preview slot: append, as before
      : kids.slice(0, slotIdx).filter((c) => c.classList.contains('tile-chip') && c !== draggedChip).length;
    const tileId = draggedChip.dataset.id;
    endDragPreview();
    if (section.id === dragFrom?.sectionId && position === dragFrom.index) return; // nothing moved
    await api(`/api/tiles/${tileId}/move`, jsonBody({ section_id: section.id, position }));
    await loadDashboard();
  });
}

let draggedChip = null; // the chip being dragged (stays put; only dims)
let dragFrom = null; // { sectionId, index } at dragstart
let slot = null; // the travelling drop-preview element

function getSlot() {
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'tile-slot';
  }
  return slot;
}

function endDragPreview() {
  slot?.remove();
  for (const z of document.querySelectorAll('.sec-tiles.drop')) z.classList.remove('drop');
}

// FLIP: snapshot chip rects, apply the DOM change, then animate each chip
// from its old spot to the new one — the tiles visibly make room.
function animateReflow(zones, mutate) {
  const chips = [...new Set(zones)].flatMap((z) => (z ? [...z.querySelectorAll('.tile-chip')] : []));
  const before = new Map(chips.map((c) => [c, c.getBoundingClientRect()]));
  mutate();
  for (const c of chips) {
    const b = before.get(c);
    const a = c.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (!dx && !dy) continue;
    c.style.transition = 'none';
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      c.style.transition = 'transform 130ms ease';
      c.style.transform = '';
    });
  }
}

// Patch health dots in place — no board re-render for a poll tick.
subscribe('health', (health) => {
  for (const chip of $$('#board .tile-chip')) {
    const h = health[chip.dataset.id];
    const dot = chip.querySelector('.dot');
    if (dot && h) { dot.className = `dot ${h.status}`; dot.title = healthTitle(h); }
  }
});
