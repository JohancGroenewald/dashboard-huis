// Dashboard schema: validation + normalization of the whole state tree,
// plus helpers shared by the Store. fail() (code EVALIDATION) maps to a 400.
import crypto from 'node:crypto';
import {
  DEFAULT_DASHBOARD, FEATURE_REQUEST_STATUSES, HEALTH_TYPES as HEALTH_TYPE_VALUES,
  NOTE_COLOR_NAMES, SCHEMA_LIMITS, SECTION_HEADING_EFFECTS, WORKSPACE_BACKGROUND_EFFECTS,
} from './constants.js';

const HEALTH_TYPES = new Set(HEALTH_TYPE_VALUES);
const HEADING_EFFECTS = new Set(SECTION_HEADING_EFFECTS);
const BACKGROUND_EFFECTS = new Set(WORKSPACE_BACKGROUND_EFFECTS);
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_NAME = /^[a-zA-Z]+$/;

export function fail(msg) {
  const e = new Error(msg);
  e.code = 'EVALIDATION';
  throw e;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function checkString(val, field, { required = true, max = SCHEMA_LIMITS.defaultStringChars } = {}) {
  if (val === undefined || val === null || val === '') {
    if (required) fail(`"${field}" is required`);
    return '';
  }
  if (typeof val !== 'string') fail(`"${field}" must be a string`);
  if (val.length > max) fail(`"${field}" exceeds ${max} characters`);
  return val;
}

export function checkColor(val, field, { required = false } = {}) {
  const s = checkString(val, field, { required, max: SCHEMA_LIMITS.colorChars }).trim();
  if (!s) return '';
  if (HEX_COLOR.test(s)) return s.toLowerCase();
  if (COLOR_NAME.test(s)) return s.toLowerCase();
  fail(`"${field}" must be a hex colour or CSS colour name`);
}

function checkHeadingEffect(val) {
  const effect = val ?? 'none';
  if (!HEADING_EFFECTS.has(effect)) fail(`"section.headingEffect" must be one of ${[...HEADING_EFFECTS].join(', ')}`);
  return effect;
}

function checkUnitNumber(val, field, fallback = 1) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) fail(`"${field}" must be a number`);
  return Math.min(Math.max(n, 0), 5);
}

export function normalizeWorkspaceBackground(raw = {}) {
  if (!isPlainObject(raw)) fail('"workspace.background" must be an object');
  const effect = raw.effect ?? 'none';
  if (!BACKGROUND_EFFECTS.has(effect)) fail(`"workspace.background.effect" must be one of ${[...BACKGROUND_EFFECTS].join(', ')}`);
  const palette = Array.isArray(raw.palette)
    ? raw.palette.slice(0, 6).map((c, i) => checkColor(c, `workspace.background.palette[${i}]`)).filter(Boolean)
    : [];
  return {
    effect,
    palette,
    speed: checkUnitNumber(raw.speed, 'workspace.background.speed'),
    density: checkUnitNumber(raw.density, 'workspace.background.density'),
    intensity: checkUnitNumber(raw.intensity, 'workspace.background.intensity'),
  };
}

function checkUrl(val, field, { required = true } = {}) {
  const s = checkString(val, field, { required });
  if (!s) return '';
  // Accept http(s) and root-relative paths (e.g. /grafana). Protocol-relative
  // URLs are rejected so callers cannot smuggle an external host as a "/path".
  if (s.startsWith('//')) fail(`"${field}" must be http(s) or a /path`);
  if (s.startsWith('/')) return s;
  let u;
  try {
    u = new URL(s);
  } catch {
    fail(`"${field}" is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) fail(`"${field}" must be http(s) or a /path`);
  return s;
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

export function colorName(c) {
  if (!c) return '';
  const lc = String(c).toLowerCase();
  return NOTE_COLOR_NAMES[lc] || lc.replace('#', '');
}

// Grid layout for a card: { x, y, w, h } in grid cells. Empty = auto-place.
export function normalizeLayout(raw) {
  if (!isPlainObject(raw)) return {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(SCHEMA_LIMITS.layoutMin, Math.round(v)) : undefined);
  const out = {};
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w);
  const h = num(raw.h);
  if (x !== undefined) out.x = x;
  if (y !== undefined) out.y = y;
  if (w !== undefined) out.w = Math.min(Math.max(w, SCHEMA_LIMITS.layoutMinSize), SCHEMA_LIMITS.gridColumns);
  if (h !== undefined) out.h = Math.max(h, SCHEMA_LIMITS.layoutMinSize);
  return out;
}

export function normalizeTile(raw) {
  if (!isPlainObject(raw)) fail('tile must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: checkString(raw.name, 'tile.name', { max: SCHEMA_LIMITS.tileNameChars }),
    url: checkUrl(raw.url, 'tile.url'),
    description: checkString(raw.description, 'tile.description', { required: false, max: SCHEMA_LIMITS.tileDescriptionChars }),
    icon: checkString(raw.icon, 'tile.icon', { required: false, max: SCHEMA_LIMITS.tileIconChars }),
    color: checkColor(raw.color, 'tile.color'),
    bold: Boolean(raw.bold), // tile labels are not bold unless turned on
    health: normalizeHealth(raw.health),
    layout: normalizeLayout(raw.layout),
  };
}

export function normalizeWorkspace(raw) {
  if (!isPlainObject(raw)) fail('workspace must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: checkString(raw.name, 'workspace.name', { max: SCHEMA_LIMITS.workspaceNameChars }),
    background: normalizeWorkspaceBackground(raw.background),
  };
}

export function normalizeSection(raw) {
  if (!isPlainObject(raw)) fail('section must be an object');
  const tiles = raw.tiles ?? [];
  if (!Array.isArray(tiles)) fail('"section.tiles" must be an array');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    name: checkString(raw.name, 'section.name', { max: SCHEMA_LIMITS.sectionNameChars }),
    description: checkString(raw.description, 'section.description', { required: false, max: SCHEMA_LIMITS.sectionDescriptionChars }),
    workspaceId: checkString(raw.workspaceId, 'section.workspaceId', { required: false, max: SCHEMA_LIMITS.workspaceIdChars }),
    color: checkColor(raw.color, 'section.color'),
    borderColor: checkColor(raw.borderColor, 'section.borderColor'),
    headingColor: checkColor(raw.headingColor, 'section.headingColor'),
    headingEffect: checkHeadingEffect(raw.headingEffect),
    bold: raw.bold === undefined ? true : Boolean(raw.bold), // headings bold by default
    collapsed: Boolean(raw.collapsed),
    layout: normalizeLayout(raw.layout),
    tiles: tiles.map(normalizeTile),
  };
}

export function normalizeNote(raw) {
  if (!isPlainObject(raw)) fail('note must be an object');
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    text: checkString(raw.text, 'note.text', { required: false, max: SCHEMA_LIMITS.noteTextChars }),
    color: checkColor(raw.color, 'note.color'),
    textColor: checkColor(raw.textColor, 'note.textColor'),
    workspaceId: checkString(raw.workspaceId, 'note.workspaceId', { required: false, max: SCHEMA_LIMITS.workspaceIdChars }),
    bold: Boolean(raw.bold),
    hidden: Boolean(raw.hidden),
    layout: normalizeLayout(raw.layout),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

const FR_STATUS = new Set(FEATURE_REQUEST_STATUSES);

export function normalizeFeatureRequest(raw) {
  if (!isPlainObject(raw)) fail('feature request must be an object');
  const status = raw.status ?? 'open';
  if (!FR_STATUS.has(status)) fail(`"status" must be one of ${[...FR_STATUS].join(', ')}`);
  return {
    id: raw.id && typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    title: checkString(raw.title, 'featureRequest.title', { max: SCHEMA_LIMITS.featureTitleChars }),
    detail: checkString(raw.detail, 'featureRequest.detail', { required: false, max: SCHEMA_LIMITS.featureDetailChars }),
    requestedBy: checkString(raw.requestedBy, 'featureRequest.requestedBy', { required: false, max: SCHEMA_LIMITS.requestedByChars }) || 'unknown',
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
  const rawWorkspaces = raw.workspaces ?? [];
  if (!Array.isArray(rawWorkspaces)) fail('"workspaces" must be an array');
  const title = checkString(raw.title || 'Dashboard', 'title', { max: SCHEMA_LIMITS.dashboardTitleChars });
  const state = {
    title,
    workspaces: rawWorkspaces.map(normalizeWorkspace),
    sections: sections.map(normalizeSection),
    notes: notes.map(normalizeNote),
    featureRequests: featureRequests.map(normalizeFeatureRequest),
    updatedAt: new Date().toISOString(),
  };
  // There is always at least one workspace; older dashboards (no workspaces)
  // are migrated into a single default one named after the dashboard.
  if (!state.workspaces.length) state.workspaces = [{ id: crypto.randomUUID(), name: title }];
  const wsIds = new Set(state.workspaces.map((w) => w.id));
  const fallbackWs = state.workspaces[0].id;
  // Every section/note belongs to a workspace; unknown/missing → the default.
  for (const s of state.sections) if (!wsIds.has(s.workspaceId)) s.workspaceId = fallbackWs;
  for (const n of state.notes) if (!wsIds.has(n.workspaceId)) n.workspaceId = fallbackWs;
  state.activeWorkspaceId = wsIds.has(raw.activeWorkspaceId) ? raw.activeWorkspaceId : fallbackWs;

  // Enforce unique ids across the whole tree.
  const ids = new Set();
  const claim = (id) => {
    if (ids.has(id)) fail(`duplicate id: ${id}`);
    ids.add(id);
  };
  for (const w of state.workspaces) claim(w.id);
  for (const s of state.sections) {
    claim(s.id);
    for (const t of s.tiles) claim(t.id);
  }
  for (const n of state.notes) claim(n.id);
  for (const fr of state.featureRequests) claim(fr.id);
  return state;
}

export function defaultState() {
  return normalizeState(DEFAULT_DASHBOARD);
}
