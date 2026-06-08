// Dashboard state store: the single source of truth and the safety boundary.
//
// Every mutation revalidates the ENTIRE resulting state before it is persisted,
// so a bad partial change (from a human or from the LLM agent) can never corrupt
// the file. Disk writes are atomic (temp + rename) and every write is preceded
// by a timestamped snapshot in data/backups, so nothing is ever irreversibly
// lost. The same class runs in memory-only mode for the validation sandbox.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HEALTH_TYPES = new Set(['http', 'tcp', 'none']);

function fail(msg) {
  const e = new Error(msg);
  e.code = 'EVALIDATION';
  throw e;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkString(val, field, { required = true, max = 2000 } = {}) {
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
function colorName(c) {
  if (!c) return '';
  const lc = String(c).toLowerCase();
  return NOTE_COLOR_NAMES[lc] || lc.replace('#', '');
}

// Grid layout for a card: { x, y, w, h } in grid cells. Empty = auto-place.
function normalizeLayout(raw) {
  if (!isPlainObject(raw)) return {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : undefined);
  const out = {};
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = num(raw[k]);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

function normalizeTile(raw) {
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

function normalizeSection(raw) {
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

function normalizeNote(raw) {
  if (!isPlainObject(raw)) fail('note must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    text: checkString(raw.text, 'note.text', { required: false, max: 2000 }),
    color: checkString(raw.color, 'note.color', { required: false, max: 30 }),
    layout: normalizeLayout(raw.layout),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

const FR_STATUS = new Set(['open', 'planned', 'done', 'rejected']);

function normalizeFeatureRequest(raw) {
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

function defaultState() {
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

export class Store {
  // persist=false → memory-only (used by the validation sandbox).
  constructor({ filePath = null, backupsDir = null, maxBackups = 25, persist = true } = {}) {
    this.filePath = filePath;
    this.backupsDir = backupsDir;
    this.maxBackups = maxBackups;
    this.persist = persist && Boolean(filePath);
    this.state = null;
  }

  load() {
    if (this.persist && fs.existsSync(this.filePath)) {
      try {
        this.state = normalizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
      } catch (err) {
        // Corrupt file: preserve it and start fresh rather than crash-looping.
        const bad = `${this.filePath}.corrupt-${Date.now()}`;
        fs.renameSync(this.filePath, bad);
        console.error(`[store] ${this.filePath} was invalid (${err.message}); moved to ${bad}`);
        this.state = defaultState();
        this.#commit();
      }
    } else {
      this.state = defaultState();
      if (this.persist) this.#commit();
    }
    return this;
  }

  // Seed an in-memory store with an explicit state (validation sandbox).
  seed(state) {
    this.state = normalizeState(state);
    return this;
  }

  getState() {
    return structuredClone(this.state);
  }

  // Free-text search across tiles, sections, and notes. Returns ranked matches
  // (by number of query words found) with ids, so the agent can resolve fuzzy
  // references like "the green note" or "grafana" before acting.
  search(query) {
    const tokens = String(query || '').toLowerCase().split(/\W+/).filter(Boolean);
    if (!tokens.length) return [];
    const items = [];
    for (const sec of this.state.sections) {
      items.push({ type: 'section', id: sec.id, label: sec.name, layout: sec.layout, _hay: `section ${sec.name}` });
      for (const t of sec.tiles) {
        items.push({
          type: 'tile', id: t.id, label: t.name, url: t.url, section: sec.name,
          _hay: `tile ${t.name} ${t.description || ''} ${t.url} ${sec.name}`,
        });
      }
    }
    for (const n of this.state.notes) {
      const color = colorName(n.color);
      items.push({
        type: 'note', id: n.id, color, label: (n.text || '').slice(0, 50) || '(empty note)', layout: n.layout,
        _hay: `note ${color} ${n.text || ''}`,
      });
    }
    return items
      .map((it) => {
        const hay = it._hay.toLowerCase();
        let score = 0;
        for (const tk of tokens) if (hay.includes(tk)) score++;
        const { _hay, ...rest } = it;
        return { ...rest, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  // ---- mutations --------------------------------------------------------
  setTitle(title) {
    this.state.title = checkString(title, 'title', { max: 120 });
    return this.#commit().title;
  }

  addSection({ name }) {
    const section = normalizeSection({ name, tiles: [] });
    this.state.sections.push(section);
    this.#commit();
    return section;
  }

  updateSection(id, patch) {
    const s = this.#section(id);
    if (patch.name !== undefined) s.name = checkString(patch.name, 'section.name', { max: 120 });
    this.#commit();
    return structuredClone(s);
  }

  removeSection(id) {
    const idx = this.state.sections.findIndex((s) => s.id === id);
    if (idx === -1) fail(`section not found: ${id}`);
    const [removed] = this.state.sections.splice(idx, 1);
    this.#commit();
    return structuredClone(removed);
  }

  moveSection(id, toIndex) {
    const idx = this.state.sections.findIndex((s) => s.id === id);
    if (idx === -1) fail(`section not found: ${id}`);
    const [s] = this.state.sections.splice(idx, 1);
    const clamped = Math.max(0, Math.min(Number(toIndex) || 0, this.state.sections.length));
    this.state.sections.splice(clamped, 0, s);
    this.#commit();
    return this.getState();
  }

  addTile(sectionId, tile) {
    const s = this.#section(sectionId);
    const newTile = normalizeTile(tile);
    s.tiles.push(newTile);
    this.#commit();
    return newTile;
  }

  updateTile(tileId, patch) {
    const { tile } = this.#tile(tileId);
    const merged = normalizeTile({ ...tile, ...patch, id: tile.id });
    Object.assign(tile, merged);
    this.#commit();
    return structuredClone(tile);
  }

  removeTile(tileId) {
    const { section, index } = this.#tile(tileId);
    const [removed] = section.tiles.splice(index, 1);
    this.#commit();
    return structuredClone(removed);
  }

  moveTile(tileId, toSectionId, toIndex) {
    const { section, index, tile } = this.#tile(tileId);
    const dest = this.#section(toSectionId);
    section.tiles.splice(index, 1);
    const pos = toIndex == null ? dest.tiles.length : Number(toIndex);
    const clamped = Math.max(0, Math.min(pos, dest.tiles.length));
    dest.tiles.splice(clamped, 0, tile);
    this.#commit();
    return structuredClone(tile);
  }

  replaceState(state) {
    this.state = normalizeState(state);
    return this.#commit();
  }

  // Resize/move a single card (section or note) by merging into its layout.
  resizeCard(id, dims) {
    const target = this.state.sections.find((s) => s.id === id) || this.state.notes.find((n) => n.id === id);
    if (!target) fail(`card not found: ${id}`);
    target.layout = normalizeLayout({ ...target.layout, ...dims });
    this.#commit();
    return structuredClone(target.layout);
  }

  // Persist grid positions for many cards (tiles or notes) in one write.
  // items: [{ id, x, y, w, h }]
  setLayouts(items) {
    if (!Array.isArray(items)) fail('items must be an array');
    const byId = new Map();
    for (const s of this.state.sections) {
      byId.set(s.id, s);
      for (const t of s.tiles) byId.set(t.id, t);
    }
    for (const n of this.state.notes) byId.set(n.id, n);
    for (const it of items) {
      const target = byId.get(it.id);
      if (target) target.layout = normalizeLayout(it);
    }
    return this.#commit();
  }

  // ---- sticky notes -----------------------------------------------------
  addNote(note) {
    const n = normalizeNote(note);
    this.state.notes.push(n);
    this.#commit();
    return n;
  }

  updateNote(id, patch) {
    const n = this.#note(id);
    const merged = normalizeNote({ ...n, ...patch, id: n.id, createdAt: n.createdAt, updatedAt: new Date().toISOString() });
    Object.assign(n, merged);
    this.#commit();
    return structuredClone(n);
  }

  removeNote(id) {
    const idx = this.state.notes.findIndex((n) => n.id === id);
    if (idx === -1) fail(`note not found: ${id}`);
    const [removed] = this.state.notes.splice(idx, 1);
    this.#commit();
    return structuredClone(removed);
  }

  // ---- feature requests -------------------------------------------------
  addFeatureRequest(fr) {
    const created = normalizeFeatureRequest(fr);
    this.state.featureRequests.push(created);
    this.#commit();
    return created;
  }

  updateFeatureRequest(id, patch) {
    const fr = this.#featureRequest(id);
    const merged = normalizeFeatureRequest({ ...fr, ...patch, id: fr.id, createdAt: fr.createdAt });
    Object.assign(fr, merged);
    this.#commit();
    return structuredClone(fr);
  }

  removeFeatureRequest(id) {
    const idx = this.state.featureRequests.findIndex((f) => f.id === id);
    if (idx === -1) fail(`feature request not found: ${id}`);
    const [removed] = this.state.featureRequests.splice(idx, 1);
    this.#commit();
    return structuredClone(removed);
  }

  // ---- internals --------------------------------------------------------
  #note(id) {
    const n = this.state.notes.find((x) => x.id === id);
    if (!n) fail(`note not found: ${id}`);
    return n;
  }

  #featureRequest(id) {
    const fr = this.state.featureRequests.find((x) => x.id === id);
    if (!fr) fail(`feature request not found: ${id}`);
    return fr;
  }

  #section(id) {
    const s = this.state.sections.find((x) => x.id === id);
    if (!s) fail(`section not found: ${id}`);
    return s;
  }

  #tile(tileId) {
    for (const section of this.state.sections) {
      const index = section.tiles.findIndex((t) => t.id === tileId);
      if (index !== -1) return { section, index, tile: section.tiles[index] };
    }
    fail(`tile not found: ${tileId}`);
  }

  #commit() {
    // Revalidate the whole tree, then persist atomically with a backup.
    this.state = normalizeState(this.state);
    if (this.persist) {
      this.#backup();
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmp, this.filePath);
    }
    return this.state;
  }

  #backup() {
    if (!this.backupsDir || !fs.existsSync(this.filePath)) return;
    fs.mkdirSync(this.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.filePath, path.join(this.backupsDir, `dashboard-${stamp}.json`));
    const files = fs
      .readdirSync(this.backupsDir)
      .filter((f) => f.startsWith('dashboard-'))
      .sort();
    while (files.length > this.maxBackups) {
      fs.unlinkSync(path.join(this.backupsDir, files.shift()));
    }
  }
}
