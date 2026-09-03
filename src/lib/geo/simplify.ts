import { toLocalMetres } from "./measure";

export interface LonLat {
  lon: number;
  lat: number;
}

function perpendicularDistanceSq(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2;
  }
  // Projection parameter, clamped to the segment.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/**
 * Ramer-Douglas-Peucker in local metres, returning the indices kept.
 *
 * Iterative rather than recursive: a dense multi-day track is long enough that
 * the recursive form can blow the stack on pathological inputs.
 */
export function douglasPeuckerIndices(points: LonLat[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);

  const originLat = points[Math.floor(n / 2)].lat;
  const xy: [number, number][] = points.map((p) => toLocalMetres(p.lon, p.lat, originLat));

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const tolSq = toleranceM * toleranceM;
  const stack: [number, number][] = [[0, n - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    let maxDistSq = -1;
    let maxIdx = -1;
    for (let i = first + 1; i < last; i++) {
      const dSq = perpendicularDistanceSq(xy[i], xy[first], xy[last]);
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        maxIdx = i;
      }
    }

    if (maxDistSq > tolSq && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx], [maxIdx, last]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/**
 * Simplifies down to roughly `target` points by binary-searching the tolerance.
 *
 * The viewer has a fixed point budget, but the right tolerance for that budget
 * depends entirely on the track — a 40 km ski tour and a 300 m boulder approach
 * need tolerances two orders of magnitude apart. Searching for the tolerance
 * that hits the budget is what makes one budget work for both.
 */
export function simplifyToTarget(
  points: LonLat[],
  target: number,
  maxIterations = 18,
): { indices: number[]; toleranceM: number } {
  if (points.length <= target) {
    return { indices: points.map((_, i) => i), toleranceM: 0 };
  }

  let lo = 0;
  let hi = 2000; // metres; wider than any sane track deviation
  let best = douglasPeuckerIndices(points, hi);
  let bestTol = hi;

  for (let iter = 0; iter < maxIterations; iter++) {
    const mid = (lo + hi) / 2;
    const indices = douglasPeuckerIndices(points, mid);

    if (indices.length > target) {
      // Too detailed: raise the tolerance.
      lo = mid;
    } else {
      // Fits the budget; keep it and try to do better (more detail).
      best = indices;
      bestTol = mid;
      hi = mid;
    }
    if (hi - lo < 0.5) break;
  }

  return { indices: best, toleranceM: bestTol };
}
