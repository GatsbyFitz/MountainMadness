import { haversine } from "./measure";
import type { RawPoint } from "./types";

export interface CleanOptions {
  /** Consecutive samples closer than this are treated as one. Metres. */
  minSpacingM?: number;
  /** Window for the median filter on elevation. Odd number of samples. */
  medianWindow?: number;
  /** Samples implying a speed above this are dropped as GPS teleports. m/s. */
  maxSpeedMps?: number;
}

const DEFAULTS: Required<CleanOptions> = {
  minSpacingM: 1,
  medianWindow: 5,
  maxSpeedMps: 45, // ~160 km/h: a paraglider descent is plausible, a jump to another valley is not
};

/** Drops the 0,0 sentinel that devices emit before they acquire a fix. */
function isNullIsland(p: RawPoint): boolean {
  return Math.abs(p.lat) < 1e-6 && Math.abs(p.lon) < 1e-6;
}

function isPlausible(p: RawPoint): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180 &&
    !isNullIsland(p)
  );
}

/**
 * Median filter over elevation.
 *
 * This runs before any gain accumulation on purpose. Raw GPS and barometric
 * elevation carries metre-scale noise at every sample, and summing the raw
 * series inflates cumulative gain by 20-40% — the single most common wrong
 * number in trip logging apps.
 */
export function medianFilter(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice();
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);

  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    const slice = values.slice(lo, hi + 1).sort((a, b) => a - b);
    out[i] = slice[Math.floor(slice.length / 2)];
  }
  return out;
}

/**
 * Fills null elevations by linear interpolation between known neighbours,
 * extending flat at either end. Returns null if nothing is known at all.
 */
export function fillElevation(points: RawPoint[]): number[] | null {
  const known = points.map((p) => (p.ele === null || !Number.isFinite(p.ele) ? null : p.ele));
  if (known.every((v) => v === null)) return null;

  const out = new Array<number>(known.length);
  let lastIdx = -1;

  for (let i = 0; i < known.length; i++) {
    const v = known[i];
    if (v === null) continue;
    if (lastIdx === -1) {
      // Extend the first known value backwards.
      for (let j = 0; j <= i; j++) out[j] = v;
    } else {
      const span = i - lastIdx;
      const from = out[lastIdx];
      for (let j = 1; j <= span; j++) {
        out[lastIdx + j] = from + ((v - from) * j) / span;
      }
    }
    lastIdx = i;
  }
  // Extend the last known value forwards.
  for (let j = lastIdx + 1; j < known.length; j++) out[j] = out[lastIdx];
  return out;
}

export interface CleanResult {
  points: RawPoint[];
  dropped: { implausible: number; duplicate: number; teleport: number };
}

/**
 * Removes junk samples and smooths elevation, preserving order and timing.
 * Everything dropped is counted so ingest can report it rather than hide it.
 */
export function cleanPoints(raw: RawPoint[], options: CleanOptions = {}): CleanResult {
  const opts = { ...DEFAULTS, ...options };
  const dropped = { implausible: 0, duplicate: 0, teleport: 0 };

  const plausible: RawPoint[] = [];
  for (const p of raw) {
    if (!isPlausible(p)) dropped.implausible++;
    else plausible.push(p);
  }

  const kept: RawPoint[] = [];
  for (const p of plausible) {
    const prev = kept[kept.length - 1];
    if (!prev) {
      kept.push(p);
      continue;
    }
    const dist = haversine(prev.lat, prev.lon, p.lat, p.lon);

    if (prev.t !== null && p.t !== null) {
      const dt = (p.t - prev.t) / 1000;
      if (dt > 0 && dist / dt > opts.maxSpeedMps) {
        dropped.teleport++;
        continue;
      }
    }
    // Keep sub-spacing samples only when they carry new time information,
    // so a legitimate rest stop still contributes to elapsed duration.
    if (dist < opts.minSpacingM && (prev.t === null || p.t === null || p.t === prev.t)) {
      dropped.duplicate++;
      continue;
    }
    kept.push(p);
  }

  const filled = fillElevation(kept);
  const smoothed = filled ? medianFilter(filled, opts.medianWindow) : null;

  return {
    points: kept.map((p, i) => ({ ...p, ele: smoothed ? smoothed[i] : null })),
    dropped,
  };
}
