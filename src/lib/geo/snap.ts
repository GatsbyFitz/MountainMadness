import { haversine } from "./measure";
import { sampleElevations, type TerrainSourceConfig, type TileFetcher } from "./terrain";

export type SnapMode = "max" | "min" | "near";

export interface SnapResult {
  lat: number;
  lon: number;
  ele: number;
  /** Horizontal distance from the original guess, metres. */
  movedM: number;
  /** True when no candidate beat the guess within maxMoveM, so it was kept. */
  keptGuess: boolean;
}

/**
 * Corrects an approximate coordinate against the DEM.
 *
 * Hand-entered waypoints drift: a summit guess lands on a shoulder, a trailhead
 * guess lands on the valley wall. Rather than trusting the guess, scan a small
 * grid around it and take the point the terrain says it should be — the local
 * maximum for a summit, the minimum for a valley floor, or the point closest to
 * a published elevation for a hut.
 *
 * This is a correction, not a geocoder: it fixes a coordinate that is roughly
 * right and cannot find one that is wrong. `correctionM` is reported so a large
 * move can be treated as a bad guess rather than silently accepted.
 */
export async function snapToTerrain(
  guess: { lat: number; lon: number },
  options: {
    mode: SnapMode;
    radiusDeg?: number;
    gridSize?: number;
    targetEle?: number;
    /**
     * Hard cap on how far a point may move, metres. A snap that relocates a
     * waypoint by kilometres has found a different place at a similar height,
     * not a better version of this one.
     */
    maxMoveM?: number;
    source: TerrainSourceConfig;
    fetchTile: TileFetcher;
    zoom?: number;
  },
): Promise<SnapResult | null> {
  const {
    mode,
    radiusDeg = 0.01,
    gridSize = 21,
    targetEle = 0,
    maxMoveM = 400,
    source,
    fetchTile,
    zoom = 13,
  } = options;

  const points: { lat: number; lon: number }[] = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      points.push({
        lat: guess.lat - radiusDeg + (2 * radiusDeg * i) / (gridSize - 1),
        lon: guess.lon - radiusDeg + (2 * radiusDeg * j) / (gridSize - 1),
      });
    }
  }

  const elevations = await sampleElevations(points, source, fetchTile, zoom);

  let bestIndex = -1;
  let bestScore = Infinity;
  for (let i = 0; i < points.length; i++) {
    const z = elevations[i];
    if (z === null) continue;
    // Candidates outside the cap are a different place, not a better fix.
    if (haversine(guess.lat, guess.lon, points[i].lat, points[i].lon) > maxMoveM) continue;

    const score = mode === "max" ? -z : mode === "min" ? z : Math.abs(z - targetEle);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const centreIndex = Math.floor(gridSize / 2) * gridSize + Math.floor(gridSize / 2);
  const guessEle = elevations[centreIndex];

  // Nothing within the cap: keep the guess rather than relocating the point.
  if (bestIndex === -1) {
    if (guessEle === null) return null;
    return { lat: guess.lat, lon: guess.lon, ele: guessEle, movedM: 0, keptGuess: true };
  }

  return {
    lat: points[bestIndex].lat,
    lon: points[bestIndex].lon,
    ele: elevations[bestIndex]!,
    movedM: haversine(guess.lat, guess.lon, points[bestIndex].lat, points[bestIndex].lon),
    keptGuess: false,
  };
}
