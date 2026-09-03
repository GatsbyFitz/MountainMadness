import type { ProfilePoint, TrackPoint } from "./types";

/** Linear interpolation between two indexed samples. */
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/**
 * Resamples the track to evenly spaced points along distance.
 *
 * Even spacing (rather than every Nth sample) is what makes the chart honest:
 * GPS sampling is time-based, so a rest stop produces hundreds of samples in
 * one place and would otherwise occupy a quarter of the x-axis.
 */
export function buildProfile(points: TrackPoint[], samples = 500): ProfilePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0];
    return [{ d: 0, z: p.ele ?? 0, demZ: p.demZ, t: p.t }];
  }

  const total = points[points.length - 1].d;
  if (total <= 0) {
    const p = points[0];
    return [{ d: 0, z: p.ele ?? 0, demZ: p.demZ, t: p.t }];
  }

  const n = Math.min(samples, points.length);
  const out: ProfilePoint[] = [];
  let cursor = 0;

  for (let i = 0; i < n; i++) {
    const targetD = (total * i) / (n - 1);

    while (cursor < points.length - 2 && points[cursor + 1].d < targetD) cursor++;

    const a = points[cursor];
    const b = points[cursor + 1] ?? a;
    const span = b.d - a.d;
    const f = span > 0 ? (targetD - a.d) / span : 0;

    out.push({
      d: Math.round(targetD),
      z: Math.round(lerp(a.ele ?? 0, b.ele ?? a.ele ?? 0, f) * 10) / 10,
      demZ:
        a.demZ === null || b.demZ === null
          ? (a.demZ ?? b.demZ)
          : Math.round(lerp(a.demZ, b.demZ, f) * 10) / 10,
      t: a.t === null || b.t === null ? a.t : Math.round(lerp(a.t, b.t, f)),
    });
  }

  return out;
}

/**
 * Trims a fixed distance from both ends of the track.
 *
 * Mountain tracks routinely start in a trailhead car park and sometimes at
 * someone's front door. This runs server-side, before geometry reaches any
 * client or tile, because a client-side privacy control is not one.
 */
export function trimForPrivacy(points: TrackPoint[], radiusM: number): TrackPoint[] {
  if (radiusM <= 0 || points.length === 0) return points;

  const total = points[points.length - 1].d;
  if (total <= radiusM * 2) return points; // Trimming would leave nothing.

  const kept = points.filter((p) => p.d >= radiusM && p.d <= total - radiusM);
  if (kept.length < 2) return points;

  // Re-base cumulative distance so the trimmed track starts at zero.
  const offset = kept[0].d;
  return kept.map((p) => ({ ...p, d: p.d - offset }));
}
