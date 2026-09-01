import { fetchDemTile } from "@/lib/geo/fetch-tile";
import { ingestGpx } from "@/lib/geo/pipeline";
import { putBlob } from "@/lib/store/blob";
import { getStore } from "@/lib/store";
import type { Trip } from "@/lib/store/types";
import { getUpstreamTerrainSource } from "@/lib/tiles/sources";

export interface IngestRequest {
  filename: string;
  xml: string;
  userId: string;
  title?: string;
  visibility?: Trip["visibility"];
  /** Metres trimmed from each end of the track before storage. */
  privacyStartM?: number;
  /** Skip DEM sampling — much faster, and the fallback when tiles are down. */
  skipTerrain?: boolean;
}

export interface IngestSummary {
  tripId: string;
  trackId: string;
  name: string | null;
  points: number;
  demSampled: boolean;
  dropped: { implausible: number; duplicate: number; teleport: number };
}

/**
 * Upload -> stored trip and track.
 *
 * Runs the geo pipeline, keeps the raw file, and writes both records. Sampling
 * the DEM per point is the slow step, which is why production runs this from a
 * Blob webhook with a raised maxDuration rather than inline in a request.
 */
export async function ingestUpload(req: IngestRequest): Promise<IngestSummary> {
  const store = getStore();

  const rawUrl = await putBlob(`${Date.now()}-${req.filename}`, req.xml);

  const source = getUpstreamTerrainSource();
  const result = await ingestGpx(req.xml, {
    targetPoints: 3000,
    profileSamples: 500,
    privacyStartM: req.privacyStartM ?? 0,
    terrain: req.skipTerrain
      ? undefined
      : { source, fetchTile: (url) => fetchDemTile(url) },
  });

  const startedAt = result.startedAt ? new Date(result.startedAt).toISOString() : null;

  const trip = await store.createTrip({
    userId: req.userId,
    title: req.title ?? result.name ?? "Untitled trip",
    startedAt,
    peakId: null,
    routeIds: [],
    outcome: null,
    highpointM: result.stats.maxEleM,
    notes: null,
    // Private by default. The user promotes it after reviewing what the track
    // actually shows.
    visibility: req.visibility ?? "private",
  });

  const track = await store.saveTrack({
    tripId: trip.id,
    source: "gpx",
    rawBlobUrl: rawUrl,
    line: result.line,
    bbox: result.bbox,
    stats: result.stats,
    profile: result.profile,
    privacyStartM: result.privacyStartM,
    startedAt,
    demSampled: result.demSampled,
  });

  return {
    tripId: trip.id,
    trackId: track.id,
    name: result.name,
    points: result.line.length,
    demSampled: result.demSampled,
    dropped: result.dropped,
  };
}
