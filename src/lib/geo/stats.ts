import { haversine } from "./measure";
import type { RawPoint, TrackStats } from "./types";

export interface StatsOptions {
  /**
   * Hysteresis band for gain accumulation, metres. A wiggle smaller than this
   * never becomes gain, however many samples it spans.
   */
  gainThresholdM?: number;
  /** Below this speed the athlete counts as stopped. m/s. */
  movingSpeedMps?: number;
  /** Gaps longer than this are excluded from moving time entirely. Seconds. */
  maxGapS?: number;
  /** Grade is measured over at least this run, to avoid single-sample spikes. */
  gradeWindowM?: number;
}

const DEFAULTS: Required<StatsOptions> = {
  gainThresholdM: 3,
  movingSpeedMps: 0.3,
  maxGapS: 120,
  gradeWindowM: 30,
};

/** Cumulative distance from the start, in metres, one entry per point. */
export function cumulativeDistances(points: RawPoint[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      total += haversine(
        points[i - 1].lat,
        points[i - 1].lon,
        points[i].lat,
        points[i].lon,
      );
    }
    out[i] = total;
  }
  return out;
}

/**
 * Accumulates gain and loss with a hysteresis band rather than by thresholding
 * each consecutive delta.
 *
 * The difference matters: per-delta thresholding discards a long steady climb
 * made of 1 m steps, while hysteresis holds a reference elevation and banks the
 * whole rise once the band is cleared. That gets both a staircase ridge and a
 * noisy flat traverse right, where naive summation gets neither.
 */
export function gainLoss(
  elevations: number[],
  thresholdM: number,
): { gain: number; loss: number } {
  if (elevations.length < 2) return { gain: 0, loss: 0 };

  let gain = 0;
  let loss = 0;
  // The last elevation we committed to the totals. Movement inside
  // [ref - threshold, ref + threshold] is noise and never banks anything.
  let ref = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const z = elevations[i];
    if (z - ref >= thresholdM) {
      gain += z - ref;
      ref = z;
    } else if (ref - z >= thresholdM) {
      loss += ref - z;
      ref = z;
    }
  }
  // Note: up to `thresholdM` of the final approach to each summit or col is
  // never committed. That bounded underestimate is the price of rejecting
  // noise, and it is the right side to err on.
  return { gain, loss };
}

export function computeStats(points: RawPoint[], options: StatsOptions = {}): TrackStats {
  const opts = { ...DEFAULTS, ...options };

  if (points.length === 0) {
    return {
      distanceM: 0,
      gainM: 0,
      lossM: 0,
      durationS: null,
      movingS: null,
      minEleM: null,
      maxEleM: null,
      maxGrade: null,
    };
  }

  const dist = cumulativeDistances(points);
  const distanceM = dist[dist.length - 1];

  const elevations = points
    .map((p) => p.ele)
    .filter((e): e is number => e !== null && Number.isFinite(e));
  const hasEle = elevations.length === points.length;

  const { gain, loss } = hasEle
    ? gainLoss(elevations, opts.gainThresholdM)
    : { gain: 0, loss: 0 };

  // Duration and moving time.
  const times = points.map((p) => p.t).filter((t): t is number => t !== null);
  let durationS: number | null = null;
  let movingS: number | null = null;

  if (times.length >= 2) {
    durationS = Math.round((times[times.length - 1] - times[0]) / 1000);
    let moving = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.t === null || b.t === null) continue;
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0 || dt > opts.maxGapS) continue;
      const step = dist[i] - dist[i - 1];
      if (step / dt >= opts.movingSpeedMps) moving += dt;
    }
    movingS = Math.round(moving);
  }

  // Steepest grade over a run of at least gradeWindowM.
  let maxGrade: number | null = null;
  if (hasEle && points.length > 1) {
    let j = 0;
    for (let i = 1; i < points.length; i++) {
      // Advance the trailing edge only while the window would still span at
      // least gradeWindowM, so we measure over the shortest qualifying run
      // rather than shrinking the window below the threshold entirely.
      while (j < i - 1 && dist[i] - dist[j + 1] >= opts.gradeWindowM) j++;
      const run = dist[i] - dist[j];
      if (run < opts.gradeWindowM) continue;
      const rise = Math.abs(elevations[i] - elevations[j]);
      const grade = rise / run;
      if (maxGrade === null || grade > maxGrade) maxGrade = grade;
    }
  }

  return {
    distanceM: Math.round(distanceM),
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    durationS,
    movingS,
    minEleM: hasEle ? Math.round(Math.min(...elevations)) : null,
    maxEleM: hasEle ? Math.round(Math.max(...elevations)) : null,
    maxGrade,
  };
}
