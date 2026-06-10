import assert from 'node:assert/strict';
import test from 'node:test';
import { routeCableBetweenRects, segHit } from '../public/js/board/cable-route.js';

function assertClearPath(points, rects) {
  for (let i = 1; i < points.length; i++) {
    for (const rect of rects) {
      assert.equal(segHit(points[i - 1], points[i], rect), null);
    }
  }
}

test('palette cable routes around overlapping palette and section boxes', () => {
  const palette = { left: 130, top: 130, right: 300, bottom: 260 };
  const section = { left: 100, top: 100, right: 250, bottom: 220 };

  const points = routeCableBetweenRects(palette, section, [palette, section], 14);

  assert.ok(points.length >= 4);
  assertClearPath(points, [palette, section]);
});

test('palette cable remains drawable when palette and section sockets coincide', () => {
  const palette = { left: 100, top: 100, right: 250, bottom: 220 };
  const section = { left: 100, top: 100, right: 250, bottom: 220 };

  const points = routeCableBetweenRects(palette, section, [palette, section], 14);

  assert.ok(points.length >= 3);
  assertClearPath(points, [palette, section]);
});

test('palette cable avoids an intervening board card', () => {
  const palette = { left: 60, top: 140, right: 160, bottom: 240 };
  const section = { left: 360, top: 140, right: 460, bottom: 240 };
  const blocker = { left: 200, top: 100, right: 320, bottom: 280 };

  const points = routeCableBetweenRects(palette, section, [palette, section, blocker], 14);

  assert.ok(points.length > 4);
  assertClearPath(points, [palette, section, blocker]);
});
