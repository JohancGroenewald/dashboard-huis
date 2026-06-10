// Pure geometry for the palette cable: route a line between two points while
// dodging rectangular obstacles (board cards, the dock). Greedy corner-detour
// routing — when a segment crosses a rect, go around its cheapest corner and
// recurse on both halves. No DOM in here, so it's unit-testable in node.

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// Nearest point on (the boundary of) rect r to point p. If p is inside, the
// nearest boundary point of the dominant axis is returned.
export function clampToEdge(p, r) {
  const x = clamp(p.x, r.left, r.right);
  const y = clamp(p.y, r.top, r.bottom);
  if (x !== p.x || y !== p.y) return { x, y }; // p outside → clamp is on the edge
  const d = [
    { x, y: r.top, gap: p.y - r.top },
    { x, y: r.bottom, gap: r.bottom - p.y },
    { x: r.left, y, gap: p.x - r.left },
    { x: r.right, y, gap: r.right - p.x },
  ];
  return d.sort((a, b) => a.gap - b.gap)[0];
}

export const inflate = (r, pad) => ({ left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad });
export const ptInside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;

// Outward normal of the rect edge a boundary point sits on.
export function edgeNormal(p, r, eps = 0.5) {
  if (Math.abs(p.x - r.left) < eps) return { x: -1, y: 0 };
  if (Math.abs(p.x - r.right) < eps) return { x: 1, y: 0 };
  if (Math.abs(p.y - r.top) < eps) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

// Liang-Barsky: does segment a→b cross the interior of rect r? Returns the
// entry parameter t (0..1) when it does, or null.
export function segHit(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.left, r.right - a.x, a.y - r.top, r.bottom - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  if (t1 - t0 < 1e-6) return null; // grazing a corner doesn't count
  return t0;
}

// The first (nearest to a) obstacle whose rect the segment crosses.
function firstBlocking(a, b, obstacles) {
  let best = null;
  for (const r of obstacles) {
    const t = segHit(a, b, r);
    if (t !== null && (best === null || t < best.t)) best = { t, r };
  }
  return best?.r || null;
}

const corners = (r) => [
  { x: r.left, y: r.top },
  { x: r.right, y: r.top },
  { x: r.right, y: r.bottom },
  { x: r.left, y: r.bottom },
];

// Waypoints from a to b (b included) avoiding all obstacle rects: detour via
// the cheapest reachable corner of the first blocking rect and recurse on
// both halves. Corners come from the rect inflated by `pad` while crossing
// tests use the original rect, so legs may run alongside an obstacle without
// being counted as crossing it. Only the incoming leg must clear the blocker
// — the recursion routes the outgoing leg around it corner by corner. Falls
// back to the straight hop when boxed in or too deep.
export function routeCable(a, b, obstacles, pad = 12, depth = 0) {
  if (depth > 8) return [b];
  const block = firstBlocking(a, b, obstacles);
  if (!block) return [b];
  const usable = corners(inflate(block, pad))
    .filter((c) => segHit(a, c, block) === null && dist(a, c) > 1 && dist(c, b) > 1)
    .sort((c1, c2) => (dist(a, c1) + dist(c1, b)) - (dist(a, c2) + dist(c2, b)));
  if (!usable.length) return [b];
  const via = usable[0];
  return [...routeCable(a, via, obstacles, pad, depth + 1), ...routeCable(via, b, obstacles, pad, depth + 1)];
}
