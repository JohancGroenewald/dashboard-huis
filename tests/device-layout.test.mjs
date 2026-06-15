import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_MODES, layoutFor, mergeDeviceLayouts, normalizeDeviceLayout, normalizeDeviceLayouts,
} from '../public/js/board/device-layout.js';

test('device layouts keep wide and narrow arrangements separate', () => {
  let layouts = mergeDeviceLayouts({}, [{ id: 'card-a', x: 2, y: 3, w: 4, h: 5 }], LAYOUT_MODES.wide);
  layouts = mergeDeviceLayouts(layouts, [{ id: 'card-a', x: 8, y: 1, w: 6, h: 2 }], LAYOUT_MODES.narrow);

  assert.deepEqual(layoutFor(layouts, 'card-a', {}, LAYOUT_MODES.wide), { x: 2, y: 3, w: 4, h: 5 });
  assert.deepEqual(layoutFor(layouts, 'card-a', {}, LAYOUT_MODES.narrow), { x: 0, y: 1, w: 1, h: 2 });
});

test('device layout falls back to server layout when no local layout exists', () => {
  const layouts = normalizeDeviceLayouts({});
  assert.deepEqual(layoutFor(layouts, 'card-b', { x: 1, y: 2, w: 3, h: 4 }, LAYOUT_MODES.wide), {
    x: 1, y: 2, w: 3, h: 4,
  });
});

test('device layout pruning removes cards no longer on the dashboard', () => {
  const starting = normalizeDeviceLayouts({
    wide: { keep: { x: 1, y: 1, w: 2, h: 2 }, stale: { x: 2, y: 2, w: 2, h: 2 } },
    narrow: { stale: { x: 0, y: 9, w: 1, h: 1 } },
  });
  const layouts = mergeDeviceLayouts(starting, [{ id: 'keep', x: 3, y: 4, w: 5, h: 6 }], LAYOUT_MODES.wide, new Set(['keep']));

  assert.deepEqual(Object.keys(layouts.wide), ['keep']);
  assert.deepEqual(Object.keys(layouts.narrow), []);
  assert.deepEqual(layoutFor(layouts, 'keep', {}, LAYOUT_MODES.wide), { x: 3, y: 4, w: 5, h: 6 });
});

test('device layout normalizes invalid values and caps width', () => {
  assert.deepEqual(normalizeDeviceLayout({ x: -2, y: 1.4, w: 99, h: 0 }), { x: 0, y: 1, w: 12, h: 1 });
  assert.deepEqual(normalizeDeviceLayout({ x: 5, y: 2, w: 3, h: 4 }, LAYOUT_MODES.narrow), { x: 0, y: 2, w: 1, h: 4 });
});
