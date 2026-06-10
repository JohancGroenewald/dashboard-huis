// Pure geometry for the palette cable: route a line between two points while
// dodging rectangular obstacles (board cards, the dock). Bounded corner-detour
// routing tries clear corners around each blocking rect. No DOM in here, so
// it's unit-testable in node.

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const pointKey = (p) => `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
const rectKey = (r) => `${Math.round(r.left * 10)}:${Math.round(r.top * 10)}:${Math.round(r.right * 10)}:${Math.round(r.bottom * 10)}`;

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
const ptInsideAny = (p, obstacles) => obstacles.some((r) => ptInside(p, r));
const segmentClear = (a, b, obstacles) => obstacles.every((r) => segHit(a, b, r) === null);
const pathClear = (pts, obstacles) => pts.slice(1).every((p, i) => segmentClear(pts[i], p, obstacles));
const offset = (p, n, by) => ({ x: p.x + n.x * by, y: p.y + n.y * by });

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

const uniqueRects = (rects) => {
  const seen = new Set();
  const out = [];
  for (const r of rects) {
    if (!r || r.right <= r.left || r.bottom <= r.top) continue;
    const key = rectKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
};

const dedupePoints = (pts) => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.5);

function searchRoute(a, b, obstacles, pad, depth = 0, seen = new Set()) {
  if (depth > 10) return null;
  const block = firstBlocking(a, b, obstacles);
  if (!block) return [b];
  const usable = corners(inflate(block, pad))
    .filter((c) => (
      dist(a, c) > 1
      && dist(c, b) > 1
      && !ptInsideAny(c, obstacles)
      && segmentClear(a, c, obstacles)
    ))
    .sort((c1, c2) => (dist(a, c1) + dist(c1, b)) - (dist(a, c2) + dist(c2, b)));

  for (const via of usable) {
    const key = pointKey(via);
    if (seen.has(key)) continue;
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    const rest = searchRoute(via, b, obstacles, pad, depth + 1, nextSeen);
    if (rest) return [via, ...rest];
  }
  return null;
}

const sideFractions = [0.2, 0.5, 0.8];

function socketCandidates(rect, avoidRect) {
  const pts = [];
  const seen = new Set();
  const add = (point, normal, bias = 0) => {
    if (avoidRect && ptInside(point, avoidRect)) return;
    const key = pointKey(point);
    if (seen.has(key)) return;
    seen.add(key);
    pts.push({ point, normal, bias });
  };
  const avoidCenter = avoidRect && { x: (avoidRect.left + avoidRect.right) / 2, y: (avoidRect.top + avoidRect.bottom) / 2 };
  if (avoidCenter) {
    const facing = clampToEdge(avoidCenter, rect);
    add(facing, edgeNormal(facing, rect), -20);
  }
  for (const f of sideFractions) {
    const x = rect.left + (rect.right - rect.left) * f;
    const y = rect.top + (rect.bottom - rect.top) * f;
    add({ x, y: rect.top }, { x: 0, y: -1 }, f === 0.5 ? 0 : 8);
    add({ x, y: rect.bottom }, { x: 0, y: 1 }, f === 0.5 ? 0 : 8);
    add({ x: rect.left, y }, { x: -1, y: 0 }, f === 0.5 ? 0 : 8);
    add({ x: rect.right, y }, { x: 1, y: 0 }, f === 0.5 ? 0 : 8);
  }
  return pts;
}

// Waypoints from a to b (b included) avoiding all obstacle rects: detour via
// reachable corners of the first blocking rect until a clear path is found.
// Corners come from the rect inflated by `pad` while crossing tests use the
// original rect, so legs may run alongside an obstacle without being counted
// as crossing it. Falls back to the straight hop only when boxed in.
export function routeCable(a, b, obstacles, pad = 12, depth = 0) {
  return searchRoute(a, b, obstacles, pad, depth) || [b];
}

// Pick visible sockets on the outside of two boxes, then route between plug
// points just outside those sockets. The returned points include both box-edge
// sockets and are ordered from `fromRect` to `toRect`.
export function routeCableBetweenRects(fromRect, toRect, obstacles = [], pad = 12) {
  const all = uniqueRects([fromRect, toRect, ...obstacles]);
  const fromKey = rectKey(fromRect);
  const toKey = rectKey(toRect);
  const fromObstacles = all.filter((r) => rectKey(r) !== fromKey);
  const toObstacles = all.filter((r) => rectKey(r) !== toKey);
  const starts = socketCandidates(fromRect, toRect);
  const ends = socketCandidates(toRect, fromRect);
  const pairs = [];

  for (const start of starts) {
    for (const end of ends) {
      const outStart = offset(start.point, start.normal, pad);
      const outEnd = offset(end.point, end.normal, pad);
      if (
        ptInsideAny(start.point, fromObstacles)
        || ptInsideAny(end.point, toObstacles)
        || ptInsideAny(outStart, all)
        || ptInsideAny(outEnd, all)
      ) continue;
      pairs.push({
        start,
        end,
        outStart,
        outEnd,
        min: dist(start.point, outStart) + dist(outStart, outEnd) + dist(outEnd, end.point) + start.bias + end.bias,
      });
    }
  }

  pairs.sort((a, b) => a.min - b.min);
  for (const pair of pairs) {
    const middle = routeCable(pair.outStart, pair.outEnd, all, pad);
    const pts = dedupePoints([pair.start.point, pair.outStart, ...middle, pair.end.point]);
    if (!pathClear(pts, all)) continue;
    return pts;
  }

  const start = starts[0] || socketCandidates(fromRect)[0];
  const end = ends[0] || socketCandidates(toRect)[0];
  const outStart = offset(start.point, start.normal, pad);
  const outEnd = offset(end.point, end.normal, pad);
  return dedupePoints([start.point, outStart, ...routeCable(outStart, outEnd, all, pad), end.point]);
}
