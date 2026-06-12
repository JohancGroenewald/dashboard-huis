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
import { searchState } from './search.js';
import {
  fail, checkString, checkColor, normalizeState, normalizeSection, normalizeTile, normalizeNote, normalizeGame,
  normalizeTrigger, normalizeFeatureRequest, normalizeProblem, normalizeWorkspace, normalizeWorkspaceBackground,
  normalizeLayout, defaultState, colorName,
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
    // Monotonic revision counter: bumped by every undoable change (commit,
    // undo, redo) but not by view-only writes. Lets clients dedupe broadcast
    // echoes and lets "revert this agent run" verify nothing changed since.
    this.rev = 0;
    // Optional hook the server attaches to broadcast changes over SSE.
    // Unset in validation sandboxes and tests, where it must stay silent.
    this.onChange = null;
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
    this.rev += 1;
    this.#notify(s);
    return s;
  }

  redo() {
    if (!this.redoStack.length) return null;
    this.undoStack.push(structuredClone(this.state));
    this.state = this.redoStack.pop();
    const s = this.#persist();
    this.lastSnapshot = structuredClone(s);
    this.rev += 1;
    this.#notify(s);
    return s;
  }

  // Undo several changes in one call (used to revert a whole agent run).
  // Each step lands on the redo stack, so a batch revert is redoable.
  undoTimes(n) {
    const steps = Math.trunc(Number(n));
    if (!Number.isFinite(steps) || steps < 1) fail('steps must be a positive integer');
    let last = null;
    for (let i = 0; i < steps && this.canUndo(); i += 1) last = this.undo();
    return last || this.getState();
  }

  canUndo() { return this.undoStack.length > 0; }

  canRedo() { return this.redoStack.length > 0; }

  getState() { return structuredClone(this.state); }

  search(query) { return searchState(this.state, query); }

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

  updateWorkspaceBackground(id, background) {
    const w = this.#workspace(id);
    w.background = normalizeWorkspaceBackground({ ...w.background, ...background });
    this.#commit();
    return structuredClone(w.background);
  }

  removeWorkspace(id) {
    const w = this.#workspace(id);
    if (this.state.workspaces.length <= 1) fail('cannot remove the last workspace');
    const used = ['sections', 'notes', 'games', 'triggers'].some((k) => this.state[k].some((x) => x.workspaceId === id));
    if (used) fail(`workspace "${w.name}" is not empty — move or delete its content first`);
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
    this.#notify(s, { viewOnly: true });
    return s;
  }

  #moveToWs(card, workspaceId) {
    this.#workspace(workspaceId);
    card.workspaceId = workspaceId;
    this.#commit();
    return structuredClone(card);
  }

  moveSectionToWorkspace(sectionId, workspaceId) { return this.#moveToWs(this.#section(sectionId), workspaceId); }

  moveNoteToWorkspace(noteId, workspaceId) { return this.#moveToWs(this.#note(noteId), workspaceId); }

  moveCardToWorkspace(id, workspaceId) { return this.#moveToWs(this.#card(id), workspaceId); }

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
    if (patch.headingEffect !== undefined) next.headingEffect = patch.headingEffect;
    for (const k of ['color', 'borderColor', 'headingColor']) {
      if (patch[k] !== undefined) next[k] = checkColor(patch[k], `section.${k}`);
    }
    Object.assign(s, normalizeSection({ ...s, ...next, id: s.id, tiles: s.tiles }));
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
    this.#notify(this.state, { viewOnly: true });
    return structuredClone(s);
  }

  setAllCollapsed(collapsed, workspaceId = this.state.activeWorkspaceId) {
    for (const s of this.state.sections) if (s.workspaceId === workspaceId) s.collapsed = Boolean(collapsed);
    this.#persist({ backup: false });
    this.lastSnapshot = structuredClone(this.state);
    this.#notify(this.state, { viewOnly: true });
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

  // Any top-level card (section, note, game, trigger) by id.
  #card(id) {
    const card = this.state.sections.find((s) => s.id === id)
      || this.state.notes.find((n) => n.id === id)
      || this.state.games.find((g) => g.id === id)
      || this.state.triggers.find((t) => t.id === id);
    if (!card) fail(`nothing movable matching "${id}" — use the id of a section, note, game, or trigger`);
    return card;
  }

  // Resize/move a single card by merging into its layout.
  resizeCard(id, dims) {
    const target = this.#card(id);
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
    for (const g of this.state.games) byId.set(g.id, g);
    for (const t of this.state.triggers) byId.set(t.id, t);
    for (const it of items) {
      const target = byId.get(it.id);
      if (target) target.layout = normalizeLayout(it);
    }
    return this.#commit();
  }

  // ---- shared card CRUD ---------------------------------------------------
  #addCard(list, normalize, item) {
    const x = normalize({ ...item, workspaceId: item.workspaceId || this.state.activeWorkspaceId });
    list.push(x);
    this.#commit();
    return x;
  }

  // id and createdAt are always pinned; `extra` pins more (e.g. a game's kind).
  #patch(target, normalize, patch, extra = {}) {
    Object.assign(target, normalize({
      ...target, ...patch, id: target.id, createdAt: target.createdAt, ...extra, updatedAt: new Date().toISOString(),
    }));
    this.#commit();
    return structuredClone(target);
  }

  #removeFrom(list, id, label) {
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) fail(`${label} not found: ${id}`);
    const [removed] = list.splice(idx, 1);
    this.#commit();
    return structuredClone(removed);
  }

  // ---- sticky notes -----------------------------------------------------
  addNote(note = {}) { return this.#addCard(this.state.notes, normalizeNote, note); }

  updateNote(id, patch) { return this.#patch(this.#note(id), normalizeNote, patch); }

  removeNote(id) { return this.#removeFrom(this.state.notes, id, 'note'); }

  // ---- games --------------------------------------------------------------
  addGame(game = {}) { return this.#addCard(this.state.games, normalizeGame, game); }

  updateGame(id, patch) {
    const g = this.#game(id);
    return this.#patch(g, normalizeGame, patch, { kind: g.kind });
  }

  removeGame(id) { return this.#removeFrom(this.state.games, id, 'game'); }

  getGame(id) { return structuredClone(this.#game(id)); }

  #game(id) { return this.#find(this.state.games, id, 'game'); }

  // ---- triggers -----------------------------------------------------------
  addTrigger(trigger = {}) { return this.#addCard(this.state.triggers, normalizeTrigger, trigger); }

  updateTrigger(id, patch) { return this.#patch(this.#trigger(id), normalizeTrigger, patch); }

  removeTrigger(id) { return this.#removeFrom(this.state.triggers, id, 'trigger'); }

  getTrigger(id) { return structuredClone(this.#trigger(id)); }

  #trigger(id) { return this.#find(this.state.triggers, id, 'trigger'); }

  // ---- feature requests -------------------------------------------------
  addFeatureRequest(fr) { return this.#addCard(this.state.featureRequests, normalizeFeatureRequest, fr); }

  updateFeatureRequest(id, patch) { return this.#patch(this.#featureRequest(id), normalizeFeatureRequest, patch); }

  removeFeatureRequest(id) { return this.#removeFrom(this.state.featureRequests, id, 'feature request'); }

  // ---- problems -----------------------------------------------------------
  addProblem(p) { return this.#addCard(this.state.problems, normalizeProblem, p); }

  updateProblem(id, patch) { return this.#patch(this.#find(this.state.problems, id, 'problem'), normalizeProblem, patch); }

  removeProblem(id) { return this.#removeFrom(this.state.problems, id, 'problem'); }

  // ---- internals --------------------------------------------------------
  #find(list, id, label) {
    const x = list.find((i) => i.id === id);
    if (!x) fail(`${label} not found: ${id}`);
    return x;
  }

  #note(id) { return this.#find(this.state.notes, id, 'note'); }

  #featureRequest(id) { return this.#find(this.state.featureRequests, id, 'feature request'); }

  #section(id) { return this.#find(this.state.sections, id, 'section'); }

  #workspace(id) { return this.#find(this.state.workspaces, id, 'workspace'); }

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
    this.rev += 1;
    this.#notify(s);
    return s;
  }

  #notify(state, { viewOnly = false } = {}) {
    this.onChange?.(structuredClone(state), { rev: this.rev, viewOnly });
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
