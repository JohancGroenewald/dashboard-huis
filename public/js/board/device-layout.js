import { GRID_UI, STORAGE_KEYS } from '../constants.js';

export const LAYOUT_MODES = {
  wide: 'wide',
  narrow: 'narrow',
};

const MODES = Object.values(LAYOUT_MODES);

function blank() {
  return { version: 1, wide: {}, narrow: {} };
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function int(value, min = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.round(value));
}

export function normalizeDeviceLayout(raw, mode = LAYOUT_MODES.wide) {
  if (!plain(raw)) return {};
  const out = {};
  const narrow = mode === LAYOUT_MODES.narrow;
  const x = int(raw.x);
  const y = int(raw.y);
  const w = int(raw.w, 1);
  const h = int(raw.h, 1);
  if (x !== undefined) out.x = narrow ? 0 : x;
  if (y !== undefined) out.y = y;
  if (w !== undefined) out.w = Math.min(w, narrow ? 1 : GRID_UI.columns);
  if (h !== undefined) out.h = h;
  return out;
}

export function normalizeDeviceLayouts(raw) {
  const next = blank();
  if (!plain(raw)) return next;
  for (const mode of MODES) {
    const bucket = plain(raw[mode]) ? raw[mode] : {};
    for (const [id, layout] of Object.entries(bucket)) {
      if (!id) continue;
      const clean = normalizeDeviceLayout(layout, mode);
      if (Object.keys(clean).length) next[mode][id] = clean;
    }
  }
  return next;
}

export function readDeviceLayouts(storage = localStorage) {
  try {
    return normalizeDeviceLayouts(JSON.parse(storage.getItem(STORAGE_KEYS.deviceLayouts) || '{}'));
  } catch {
    return blank();
  }
}

export function saveDeviceLayouts(layouts, storage = localStorage) {
  try {
    storage.setItem(STORAGE_KEYS.deviceLayouts, JSON.stringify(normalizeDeviceLayouts(layouts)));
    return true;
  } catch {
    return false;
  }
}

export function layoutFor(layouts, id, fallback = {}, mode = LAYOUT_MODES.wide) {
  const safe = normalizeDeviceLayouts(layouts);
  return {
    ...(plain(fallback) ? fallback : {}),
    ...(safe[mode]?.[id] || {}),
  };
}

export function mergeDeviceLayouts(layouts, items, mode = LAYOUT_MODES.wide, liveIds = null) {
  const next = normalizeDeviceLayouts(layouts);
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    const clean = normalizeDeviceLayout(item, mode);
    if (Object.keys(clean).length) next[mode][item.id] = clean;
  }
  if (liveIds) {
    for (const bucketMode of MODES) {
      for (const id of Object.keys(next[bucketMode])) {
        if (!liveIds.has(id)) delete next[bucketMode][id];
      }
    }
  }
  return next;
}
