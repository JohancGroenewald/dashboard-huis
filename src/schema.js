// Dashboard schema: validation + normalization of the whole state tree,
// plus helpers shared by the Store. fail() (code EVALIDATION) maps to a 400.
import crypto from 'node:crypto';

const HEALTH_TYPES = new Set(['http', 'tcp', 'none']);

export function fail(msg) {
  const e = new Error(msg);
  e.code = 'EVALIDATION';
  throw e;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function checkString(val, field, { required = true, max = 2000 } = {}) {
  if (val === undefined || val === null || val === '') {
    if (required) fail(`"${field}" is required`);
    return '';
  }
  if (typeof val !== 'string') fail(`"${field}" must be a string`);
  if (val.length > max) fail(`"${field}" exceeds ${max} characters`);
  return val;
}

function checkUrl(val, field, { required = true } = {}) {
  const s = checkString(val, field, { required });
  if (!s) return '';
  try {
    // Accept http(s) and root-relative paths (e.g. /grafana).
    if (s.startsWith('/')) return s;
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) fail(`"${field}" must be http(s) or a /path`);
    return s;
  } catch {
    fail(`"${field}" is not a valid URL`);
  }
}

function normalizeHealth(h) {
  if (h === undefined || h === null) return { enabled: false, type: 'http', target: '' };
  if (!isPlainObject(h)) fail('"health" must be an object');
  const type = h.type ?? 'http';
  if (!HEALTH_TYPES.has(type)) fail(`"health.type" must be one of ${[...HEALTH_TYPES].join(', ')}`);
  return {
    enabled: Boolean(h.enabled),
    type,
    target: h.target ? checkUrl(h.target, 'health.target') : '',
  };
}

// Map the note palette hexes to colour words so "green note" is searchable.
const NOTE_COLOR_NAMES = {
  '#f6d365': 'yellow',
  '#a0e7a0': 'green',
  '#9bd0ff': 'blue',
  '#ffb3c1': 'pink',
  '#e0c3fc': 'purple',
};
export function colorName(c) {
  if (!c) return '';
  const lc = String(c).toLowerCase();
  return NOTE_COLOR_NAMES[lc] || lc.replace('#', '');
}

// Grid layout for a card: { x, y, w, h } in grid cells. Empty = auto-place.
export function normalizeLayout(raw) {
  if (!isPlainObject(raw)) return {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined);
  const out = {};
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = num(raw[k]);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

export function normalizeTile(raw) {
  if (!isPlainObject(raw)) fail('tile must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: checkString(raw.name, 'tile.name', { max: 120 }),
    url: checkUrl(raw.url, 'tile.url'),
    description: checkString(raw.description, 'tile.description', { required: false, max: 500 }),
    icon: checkString(raw.icon, 'tile.icon', { required: false, max: 40 }),
    color: checkString(raw.color, 'tile.color', { required: false, max: 30 }),
    health: normalizeHealth(raw.health),
    layout: normalizeLayout(raw.layout),
  };
}

export function normalizeSection(raw) {
  if (!isPlainObject(raw)) fail('section must be an object');
  const tiles = raw.tiles ?? [];
  if (!Array.isArray(tiles)) fail('"section.tiles" must be an array');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: checkString(raw.name, 'section.name', { max: 120 }),
    layout: normalizeLayout(raw.layout),
    tiles: tiles.map(normalizeTile),
  };
}

export function normalizeNote(raw) {
  if (!isPlainObject(raw)) fail('note must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    text: checkString(raw.text, 'note.text', { required: false, max: 2000 }),
    color: checkString(raw.color, 'note.color', { required: false, max: 30 }),
    textColor: checkString(raw.textColor, 'note.textColor', { required: false, max: 30 }),
    hidden: Boolean(raw.hidden),
    layout: normalizeLayout(raw.layout),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

const FR_STATUS = new Set(['open', 'planned', 'done', 'rejected']);

export function normalizeFeatureRequest(raw) {
  if (!isPlainObject(raw)) fail('feature request must be an object');
  const status = raw.status ?? 'open';
  if (!FR_STATUS.has(status)) fail(`"status" must be one of ${[...FR_STATUS].join(', ')}`);
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    title: checkString(raw.title, 'featureRequest.title', { max: 200 }),
    detail: checkString(raw.detail, 'featureRequest.detail', { required: false, max: 2000 }),
    requestedBy: checkString(raw.requestedBy, 'featureRequest.requestedBy', { required: false, max: 120 }) || 'unknown',
    status,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

// Validate + normalize a full state object. Returns a clean copy; throws on bad input.
export function normalizeState(raw) {
  if (!isPlainObject(raw)) fail('state must be an object');
  const sections = raw.sections ?? [];
  if (!Array.isArray(sections)) fail('"sections" must be an array');
  const notes = raw.notes ?? [];
  if (!Array.isArray(notes)) fail('"notes" must be an array');
  const featureRequests = raw.featureRequests ?? [];
  if (!Array.isArray(featureRequests)) fail('"featureRequests" must be an array');
  const state = {
    title: checkString(raw.title || 'Dashboard', 'title', { max: 120 }),
    sections: sections.map(normalizeSection),
    notes: notes.map(normalizeNote),
    featureRequests: featureRequests.map(normalizeFeatureRequest),
    updatedAt: new Date().toISOString(),
  };
  // Enforce unique ids across the whole tree.
  const ids = new Set();
  const claim = (id) => {
    if (ids.has(id)) fail(`duplicate id: ${id}`);
    ids.add(id);
  };
  for (const s of state.sections) {
    claim(s.id);
    for (const t of s.tiles) claim(t.id);
  }
  for (const n of state.notes) claim(n.id);
  for (const fr of state.featureRequests) claim(fr.id);
  return state;
}

export function defaultState() {
  return normalizeState({
    title: 'Huis',
    sections: [
      {
        name: 'Infrastructure',
        tiles: [
          {
            name: 'Ollama',
            url: 'http://ollama.huis:11434',
            description: 'Local LLM server',
            icon: '🧠',
            health: { enabled: true, type: 'http', target: 'http://ollama.huis:11434/api/version' },
          },
        ],
      },
      { name: 'Services', tiles: [] },
    ],
  });
}
