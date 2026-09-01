import { cleanPoints } from "./clean";
import { parseGpx, parseGpxName } from "./gpx";
import { bboxOf } from "./measure";
import { buildProfile, trimForPrivacy } from "./profile";
import { simplifyToTarget } from "./simplify";
import { computeStats, cumulativeDistances } from "./stats";
import { renderHeight, sampleElevations, type TerrainSourceConfig, type TileFetcher } from "./terrain";
import type { IngestedTrack, RawPoint, TrackPoint } from "./types";

export interface IngestOptions {
  /** Point budget for the geometry the viewer downloads. */
  targetPoints?: number;
  /** Samples in the elevation profile chart. */
  profileSamples?: number;
  /** Metres trimmed from each end before anything leaves the server. */
  privacyStartM?: number;
  /** Metres the drawn route floats above the DEM surface. */
  clearanceM?: number;
  terrain?: { source: TerrainSourceConfig; fetchTile: TileFetcher };
}

export interface IngestResult extends IngestedTrack {
  name: string | null;
  dropped: { implausible: number; duplicate: number; teleport: number };
  /** True when DEM sampling produced at least one elevation. */
  demSampled: boolean;
}

/**
 * The full ingest pipeline: raw file in, everything the app stores out.
 *
 * Ordering is deliberate. Cleaning precedes stats so gain is computed on a
 * smoothed series; DEM sampling precedes simplification so the render height
 * is known for the vertices we keep; privacy trimming precedes profile and
 * geometry construction so no untrimmed coordinate can escape downstream.
 */
export async function ingestGpx(
  xml: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const {
    targetPoints = 3000,
    profileSamples = 500,
    privacyStartM = 0,
    clearanceM = 15,
    terrain,
  } = options;

  const raw: RawPoint[] = parseGpx(xml);
  const name = parseGpxName(xml);
  const { points: cleaned, dropped } = cleanPoints(raw);

  if (cleaned.length < 2) {
    throw new Error("Track has fewer than two usable points after cleaning.");
  }

  // Stats come from the full-resolution cleaned series, never the simplified
  // one — simplification is a display concern and would understate distance.
  const stats = computeStats(cleaned);

  const demZ = terrain
    ? await sampleElevations(cleaned, terrain.source, terrain.fetchTile)
    : new Array<number | null>(cleaned.length).fill(null);
  const demSampled = demZ.some((z) => z !== null);

  const distances = cumulativeDistances(cleaned);
  const withDem: TrackPoint[] = cleaned.map((p, i) => ({
    ...p,
    demZ: demZ[i],
    d: distances[i],
  }));

  const trimmed = trimForPrivacy(withDem, privacyStartM);

  const { indices } = simplifyToTarget(trimmed, targetPoints);
  const line: [number, number, number][] = indices.map((i) => {
    const p = trimmed[i];
    return [p.lon, p.lat, renderHeight(p.ele, p.demZ, clearanceM)];
  });

  return {
    name,
    points: trimmed,
    line,
    stats,
    profile: buildProfile(trimmed, profileSamples),
    bbox: bboxOf(trimmed),
    startedAt: trimmed.find((p) => p.t !== null)?.t ?? null,
    privacyStartM,
    dropped,
    demSampled,
  };
}
