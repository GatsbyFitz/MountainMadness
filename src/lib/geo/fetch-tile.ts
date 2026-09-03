import { PNG } from "pngjs";

import type { DemTile } from "./terrain";

/**
 * Server-side DEM tile fetching for the ingest pipeline.
 *
 * Terrain tiles are immutable for a given z/x/y, so a per-process cache is
 * safe and worth having: a single track's points collapse onto a handful of
 * tiles, and ingest re-runs hit the same ones again.
 */

const MAX_CACHED_TILES = 64;
const cache = new Map<string, DemTile>();

function remember(url: string, tile: DemTile) {
  if (cache.size >= MAX_CACHED_TILES) {
    // Cheapest possible eviction; insertion order is close enough to LRU here.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, tile);
}

export function decodePng(buffer: Buffer): DemTile {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export interface FetchTileOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetches and decodes one terrain tile, returning null on any failure.
 *
 * Null rather than throw is deliberate: a track whose terrain tiles are
 * unreachable is still a track, and losing the DEM should cost the height
 * clamp, not the upload.
 */
export async function fetchDemTile(
  url: string,
  options: FetchTileOptions = {},
): Promise<DemTile | null> {
  const cached = cache.get(url);
  if (cached) return cached;

  const { timeoutMs = 10_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: options.signal ?? controller.signal,
      headers: { Accept: "image/png,image/*" },
    });
    if (!res.ok) {
      console.warn(`[terrain] tile ${url} -> HTTP ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const tile = decodePng(buffer);
    remember(url, tile);
    return tile;
  } catch (err) {
    console.warn(`[terrain] tile ${url} failed:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function clearTileCache() {
  cache.clear();
}
