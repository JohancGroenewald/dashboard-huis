// Dashboard state store: the single source of truth and the safety boundary.
//
// Every mutation revalidates the ENTIRE resulting state before it is persisted,
// so a bad partial change (from a human or from the LLM agent) can never corrupt
// the file. Disk writes are atomic (temp + rename) and every write is preceded
// by a timestamped snapshot in data/backups, so nothing is ever irreversibly
// lost. The same class runs in memory-only mode for the validation sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DEFAULTS, SCHEMA_LIMITS, STORE_LIMITS } from './constants.js';
import {
  fail, checkString, checkColor, normalizeState, normalizeSection, normalizeTile, normalizeNote,
  normalizeFeatureRequest, normalizeWorkspace, normalizeLayout, defaultState, colorName,
} from './schema.js';

export class Store {
  // persist=false → memory-only (used by the validation sandbox).
  constructor({
    filePath = null,
    backupsDir = null,
    maxBackups = CONFIG_DEFAULTS.maxBackups,
    persist = true,
    maxHistory = STORE_LIMITS.defaultMaxHistory,
  } = {}) {
    this.filePath = filePath;
    this.backupsDir = backupsDir;
    this.maxBackups = maxBackups;
    this.persist = persist && Boolean(filePath);
    this.state = null;
    // In-memory undo/redo of whole-state snapshots (this process only).
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshot = null;
    this.maxHistory = maxHistory;
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
        this.#persist();
      }
    } else {
      this.state = defaultState();
      if (this.persist) this.#persist();
    }
    this.lastSnapshot = structuredClone(this.state);
    return this;
  }

  // Seed an in-memory store with an explicit state (validation sandbox).
  seed(state) {
    this.state = normalizeState(state);
    this.lastSnapshot = structuredClone(this.state);
    return this;
  }

  // ---- undo / redo ------------------------------------------------------
  undo() {
    if (!this.undoStack.length) return null;
    this.redoStack.push(structuredClone(this.state));
    this.state = this.undoStack.pop();
    const s = this.#persist();
    this.lastSnapshot = structuredClone(s);
    return s;
  }

  redo() {
    if (!this.redoStack.length) return null;
    this.undoStack.push(structuredClone(this.state));
    this.state = this.redoStack.pop();
    const s = this.#persist();
    this.lastSnapshot = structuredClone(s);
    return s;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
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
        type: 'note', id: n.id, color, label: (n.text || '').slice(0, STORE_LIMITS.noteSearchLabelChars) || '(empty note)', layout: n.layout,
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
      .slice(0, STORE_LIMITS.searchResults);
  }

  // ---- mutations --------------------------------------------------------
  setTitle(title) {
    this.state.title = checkString(title, 'title', { max: SCHEMA_LIMITS.dashboardTitleChars });
    return this.#commit().title;
  }

  // ---- workspaces -------------------------------------------------------
  addWorkspace({ name }) {
    const workspace = normalizeWorkspace({ name });
    this.state.workspaces.push(workspace);
    this.#commit();
    return workspace;
  }

  renameWorkspace(id, name) {
    const w = this.#workspace(id);
    w.name = checkString(name, 'workspace.name', { max: SCHEMA_LIMITS.workspaceNameChars });
    this.#commit();
    return structuredClone(w);
  }

  removeWorkspace(id) {
    const w = this.#workspace(id);
    if (this.state.workspaces.length <= 1) fail('cannot remove the last workspace');
    const used = this.state.sections.some((s) => s.workspaceId === id) || this.state.notes.some((n) => n.workspaceId === id);
    if (used) fail(`workspace "${w.name}" is not empty — move or delete its sections and notes first`);
    this.state.workspaces = this.state.workspaces.filter((x) => x.id !== id);
    if (this.state.activeWorkspaceId === id) this.state.activeWorkspaceId = this.state.workspaces[0].id;
    this.#commit();
    return structuredClone(w);
  }

  // View-state only: which workspace the board shows / new content lands in.
  // Persisted, but NOT in undo history (and no backup churn on tab switches).
  setActiveWorkspace(id) {
    this.#workspace(id);
    this.state.activeWorkspaceId = id;
    const s = this.#persist({ backup: false });
    // Bake the view change into the baseline so it isn't captured as part of
    // the next real edit's undo entry (switching is not itself undoable).
    this.lastSnapshot = structuredClone(s);
    return s;
  }

  moveSectionToWorkspace(sectionId, workspaceId) {
    this.#workspace(workspaceId);
    const s = this.#section(sectionId);
    s.workspaceId = workspaceId;
    this.#commit();
    return structuredClone(s);
  }

  moveNoteToWorkspace(noteId, workspaceId) {
    this.#workspace(workspaceId);
    const n = this.#note(noteId);
    n.workspaceId = workspaceId;
    this.#commit();
    return structuredClone(n);
  }

  addSection({ name, description }) {
    const section = normalizeSection({ name, description, tiles: [], workspaceId: this.state.activeWorkspaceId });
    this.state.sections.push(section);
    this.#commit();
    return section;
  }

  updateSection(id, patch) {
    const s = this.#section(id);
    const next = {};
    if (patch.name !== undefined) next.name = checkString(patch.name, 'section.name', { max: SCHEMA_LIMITS.sectionNameChars });
    if (patch.description !== undefined) next.description = checkString(patch.description, 'section.description', {
      required: false,
      max: SCHEMA_LIMITS.sectionDescriptionChars,
    });
    if (patch.bold !== undefined) next.bold = Boolean(patch.bold);
    for (const k of ['color', 'borderColor', 'headingColor']) {
      if (patch[k] !== undefined) next[k] = checkColor(patch[k], `section.${k}`);
    }
    Object.assign(s, next);
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

  // Collapse/expand sections. View state: persisted so it survives reloads, but
  // not undoable and no backup (like switching the active workspace) — so a
  // "collapse all" doesn't spam history or the backup directory.
  setSectionCollapsed(id, collapsed) {
    const s = this.#section(id);
    s.collapsed = Boolean(collapsed);
    this.#persist({ backup: false });
    this.lastSnapshot = structuredClone(this.state);
    return structuredClone(s);
  }

  setAllCollapsed(collapsed, workspaceId = this.state.activeWorkspaceId) {
    for (const s of this.state.sections) if (s.workspaceId === workspaceId) s.collapsed = Boolean(collapsed);
    this.#persist({ backup: false });
    this.lastSnapshot = structuredClone(this.state);
    return this.getState();
  }

  moveSection(id, toIndex) {
    const idx = this.state.sections.findIndex((s) => s.id === id);
    if (idx === -1) fail(`section not found: ${id}`);
    const [s] = this.state.sections.splice(idx, 1);
    const clamped = Math.max(STORE_LIMITS.minIndex, Math.min(Number(toIndex) || STORE_LIMITS.minIndex, this.state.sections.length));
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
    const clamped = Math.max(STORE_LIMITS.minIndex, Math.min(pos, dest.tiles.length));
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
    const n = normalizeNote({ ...note, workspaceId: note.workspaceId || this.state.activeWorkspaceId });
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

  #workspace(id) {
    const w = this.state.workspaces.find((x) => x.id === id);
    if (!w) fail(`workspace not found: ${id}`);
    return w;
  }

  #tile(tileId) {
    for (const section of this.state.sections) {
      const index = section.tiles.findIndex((t) => t.id === tileId);
      if (index !== -1) return { section, index, tile: section.tiles[index] };
    }
    fail(`tile not found: ${tileId}`);
  }

  // A normal mutation: record the pre-change snapshot for undo, then persist.
  #commit() {
    if (this.lastSnapshot) {
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
      this.redoStack = []; // a fresh change invalidates the redo branch
    }
    const s = this.#persist();
    this.lastSnapshot = structuredClone(s);
    return s;
  }

  // Validate the whole tree and write it atomically. A backup is taken first
  // (skipped for view-only writes like switching the active workspace, so
  // tab-flipping doesn't churn the backup directory).
  #persist({ backup = true } = {}) {
    this.state = normalizeState(this.state);
    if (this.persist) {
      if (backup) this.#backup();
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
