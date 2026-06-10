// Section and note cards: HTML templates plus per-card wiring. Layout-level
// concerns (drag, resize, persistence) live in board.js; tile chips in
// tiles.js; renames and dialogs in editor.js; colours in palette.js.
import { esc, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import {
  FONT_WEIGHTS, GRID_UI, NOTE_COLORS, NOTE_DEFAULT_COLOR, NOTE_TEXT_COLORS,
  NOTE_TRANSPARENT_COLOR, SECTION_PALETTES,
} from '../constants.js';
import { loadDashboard } from '../state/store.js';
import { tileChip, wireTileZone } from './tiles.js';
import { openPalette } from './palette.js';
import { openAiMenu } from './ai-menu.js';
import { inlineEdit, addTileTo, deleteWithUndo } from './editor.js';

export function sectionInner(section) {
  const tiles = section.tiles.map(tileChip).join('') || '<div class="sec-empty">No tiles — ＋ to add, or drop one here</div>';
  const n = section.tiles.length;
  const cardStyle = [
    section.color ? `background:${esc(section.color)}` : '',
    section.borderColor ? `border-color:${esc(section.borderColor)}` : '',
  ].filter(Boolean).join(';');
  const nameStyle = ` style="font-weight:${section.bold ? FONT_WEIGHTS.semiBold : FONT_WEIGHTS.normal}${section.headingColor ? `;color:${esc(section.headingColor)}` : ''}"`;
  const desc = section.description
    ? `<div class="sec-desc" title="Click to edit description">${esc(section.description)}</div>`
    : '<div class="sec-desc empty" title="Add a description">＋ description</div>';
  return `<div class="card section-card${section.collapsed ? ' collapsed' : ''}" data-id="${section.id}"${cardStyle ? ` style="${cardStyle}"` : ''}>
    <div class="sec-head">
      <button class="sec-collapse" type="button" title="${section.collapsed ? 'Expand' : 'Collapse'} section">${section.collapsed ? '▸' : '▾'}</button>
      <span class="card-grip" title="Drag section">⠿</span>
      <span class="sec-name"${nameStyle} title="Click to rename">${esc(section.name)}</span>
      ${section.collapsed && n ? `<span class="sec-count" title="${n} tile(s)">${n}</span>` : ''}
      <button class="ctl ai-btn sec-ai" type="button" title="Dashy: act on this section">✦</button>
      <button class="ctl sec-style" type="button" title="Card colours">🎨</button>
      <button class="ctl sec-add" type="button" title="Add tile to this section">＋</button>
      <button class="ctl danger sec-del" type="button" title="Delete section">✕</button>
    </div>
    ${desc}
    <div class="sec-tiles" data-section="${section.id}">${tiles}</div>
  </div>`;
}

function noteTitle(note) {
  const text = String(note.text || '').trim();
  return text ? text.slice(0, GRID_UI.attachLabelChars) : 'Note';
}

export function noteInner(note) {
  const isTransparent = note.color === NOTE_TRANSPARENT_COLOR;
  const style = [
    `background:${esc(note.color || NOTE_DEFAULT_COLOR)}`,
    note.textColor ? `color:${esc(note.textColor)}` : (isTransparent ? 'color:var(--text)' : ''),
    note.bold ? 'font-weight:700' : '',
  ].filter(Boolean).join(';');
  return `<div class="card note-card${isTransparent ? ' transparent' : ''}" data-id="${note.id}" style="${style}">
    <div class="sec-head note-head">
      <span class="card-grip" title="Drag note">⠿</span>
      <span class="note-title" title="${esc(note.text || 'Note')}">${esc(noteTitle(note))}</span>
      <button class="ctl ai-btn note-ai" type="button" title="Dashy: act on this note">✦</button>
      <button class="ctl note-style" type="button" title="Note colours">🎨</button>
      <button class="ctl note-hide" type="button" title="Hide note">🙈</button>
      <button class="ctl danger note-del" type="button" title="Delete note">✕</button>
    </div>
    <textarea placeholder="Write a note…">${esc(note.text)}</textarea>
  </div>`;
}

export function ghostInner() {
  return '<div class="note-ghost" title="Hidden note — click to show"><span class="ghost-eye">🙈</span></div>';
}

export function wireSection(el, section) {
  const card = el.querySelector('.section-card');
  const nameEl = el.querySelector('.sec-name');

  el.querySelector('.sec-collapse').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api(`/api/sections/${section.id}/collapse`, jsonBody({ collapsed: !section.collapsed }));
    await loadDashboard();
  });
  nameEl.addEventListener('click', () => inlineEdit(nameEl, {
    value: section.name,
    onSubmit: (name) => api(`/api/sections/${section.id}`, jsonBody({ name }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.sec-desc').addEventListener('click', (e) => inlineEdit(e.currentTarget, {
    value: section.description || '',
    allowEmpty: true,
    onSubmit: (description) => api(`/api/sections/${section.id}`, jsonBody({ description }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.sec-style').addEventListener('click', (e) => {
    e.stopPropagation();
    openPalette({
      anchor: e.currentTarget,
      title: `Section: ${section.name}`,
      rows: [
        { label: 'Fill', prop: 'color', colors: SECTION_PALETTES.background, current: section.color },
        { label: 'Outline', prop: 'borderColor', colors: SECTION_PALETTES.border, current: section.borderColor },
        { label: 'Heading', prop: 'headingColor', colors: SECTION_PALETTES.heading, current: section.headingColor },
      ],
      toggles: [{ label: 'Bold heading', prop: 'bold', checked: section.bold }],
      onSwatch: ({ prop, color }) => {
        section[prop] = color;
        if (prop === 'color') card.style.background = color;
        else if (prop === 'borderColor') card.style.borderColor = color;
        else if (prop === 'headingColor') nameEl.style.color = color;
        api(`/api/sections/${section.id}`, jsonBody({ [prop]: color }, 'PATCH')).catch(() => toast('Could not save colour', { error: true }));
      },
      onToggle: ({ checked }) => {
        section.bold = checked;
        nameEl.style.fontWeight = checked ? FONT_WEIGHTS.semiBold : FONT_WEIGHTS.normal;
        api(`/api/sections/${section.id}`, jsonBody({ bold: checked }, 'PATCH')).catch(() => {});
      },
    });
  });
  el.querySelector('.sec-ai').addEventListener('click', (e) => {
    e.stopPropagation();
    openAiMenu({
      anchor: e.currentTarget,
      item: { type: 'section', id: section.id, label: section.name },
      prompts: [
        'Write a short description for this section',
        'Tidy and group these tiles',
        'Recolour this section to fit its content',
      ],
    });
  });
  el.querySelector('.sec-add').addEventListener('click', () => addTileTo(section.id));
  el.querySelector('.sec-del').addEventListener('click', () => {
    const n = section.tiles.length;
    deleteWithUndo(`/api/sections/${section.id}`, `Deleted "${section.name}"${n ? ` and its ${n} tile(s)` : ''}`);
  });

  wireTileZone(el, section);
}

export function wireNote(el, note) {
  const card = el.querySelector('.note-card');
  const ta = el.querySelector('textarea');
  const titleEl = el.querySelector('.note-title');

  ta.addEventListener('blur', () => {
    if (ta.value === note.text) return;
    note.text = ta.value;
    titleEl.textContent = noteTitle(note);
    titleEl.title = note.text || 'Note';
    api(`/api/notes/${note.id}`, jsonBody({ text: ta.value }, 'PATCH')).catch(() => toast('Could not save note', { error: true }));
  });
  el.querySelector('.note-style').addEventListener('click', (e) => {
    e.stopPropagation();
    openPalette({
      anchor: e.currentTarget,
      title: `Note: ${noteTitle(note)}`,
      rows: [
        { label: 'Fill', prop: 'color', colors: NOTE_COLORS, current: note.color },
        { label: 'Text', prop: 'textColor', colors: NOTE_TEXT_COLORS, current: note.textColor },
      ],
      toggles: [{ label: 'Bold text', prop: 'bold', checked: note.bold }],
      onSwatch: ({ prop, color }) => {
        if (prop === 'color') {
          const transparent = color === NOTE_TRANSPARENT_COLOR;
          card.classList.toggle('transparent', transparent);
          card.style.background = color || NOTE_DEFAULT_COLOR;
          if (!note.textColor) card.style.color = transparent ? 'var(--text)' : '';
          note.color = color;
        } else {
          note.textColor = color;
          card.style.color = color || (note.color === NOTE_TRANSPARENT_COLOR ? 'var(--text)' : '');
        }
        api(`/api/notes/${note.id}`, jsonBody({ [prop]: color }, 'PATCH')).catch(() => {});
      },
      onToggle: ({ checked }) => {
        note.bold = checked;
        card.style.fontWeight = checked ? '700' : '';
        api(`/api/notes/${note.id}`, jsonBody({ bold: checked }, 'PATCH')).catch(() => {});
      },
    });
  });
  el.querySelector('.note-ai').addEventListener('click', (e) => {
    e.stopPropagation();
    openAiMenu({
      anchor: e.currentTarget,
      item: { type: 'note', id: note.id, label: noteTitle(note) },
      prompts: [
        'Summarize this note',
        'Split this into separate notes',
        'Tidy up the wording',
      ],
    });
  });
  el.querySelector('.note-hide').addEventListener('click', async () => {
    await api(`/api/notes/${note.id}`, jsonBody({ hidden: true }, 'PATCH'));
    await loadDashboard();
  });
  el.querySelector('.note-del').addEventListener('click', () => deleteWithUndo(`/api/notes/${note.id}`, 'Note deleted'));
}

export function wireGhost(el, note) {
  el.querySelector('.note-ghost').addEventListener('click', async () => {
    await api(`/api/notes/${note.id}`, jsonBody({ hidden: false }, 'PATCH'));
    await loadDashboard();
  });
}
