import type { TerrainSourceConfig } from "@/lib/geo/terrain";

/**
 * Every terrain source in one place.
 *
 * The plan's rule: swapping vendors is a one-file change, because tile costs
 * scale with engagement and a 3D viewer pulls far more tiles than a 2D map.
 * Nothing outside this module names a tile host.
 */

export const TERRAIN_SOURCES = {
  /**
   * AWS Open Data terrarium tiles. Free, no API key, global coverage.
   * The default, and what the app runs on out of the box.
   */
  aws: {
    id: "aws",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    // Terrarium, NOT mapbox. Getting this wrong yields a plausible-looking
    // but wrong mountain, with no error anywhere. See geo.test.ts.
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 14,
    attribution:
      '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> on AWS Open Data',
  },

  /** MapTiler terrain-RGB. Paid and SLA-backed; needs NEXT_PUBLIC_MAPTILER_KEY. */
  maptiler: {
    id: "maptiler",
    url: `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ""}`,
    encoding: "mapbox",
    tileSize: 512,
    maxzoom: 12,
    attribution: '<a href="https://www.maptiler.com/copyright/">MapTiler</a>',
  },

  /**
   * Our own /api/dem proxy. Same bytes as the upstream it wraps, but cached at
   * the edge and with no vendor key in the client bundle. Browser-side only --
   * server-side ingest must use the upstream directly, or it would call itself.
   */
  proxy: {
    id: "proxy",
    url: "/api/dem/{z}/{x}/{y}.png",
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 14,
    attribution:
      '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> on AWS Open Data',
  },

  /** Self-hosted PMTiles or a tile server of your own. */
  custom: {
    id: "custom",
    url: process.env.NEXT_PUBLIC_TERRAIN_TILE_URL ?? "",
    encoding: "terrarium",
    tileSize: 512,
    maxzoom: 12,
    attribution: "Self-hosted terrain",
  },
} as const satisfies Record<string, TerrainSourceConfig>;

export type TerrainSourceId = keyof typeof TERRAIN_SOURCES;

/**
 * The source that actually holds the tiles.
 *
 * Never returns the proxy entry: the proxy fetches *from* this, so resolving
 * it to itself would make the route call its own endpoint in a loop. Ingest
 * and the proxy route both use this; only the browser gets `proxy`.
 */
export function getUpstreamTerrainSource(): TerrainSourceConfig {
  const configured = (process.env.TERRAIN_UPSTREAM ??
    process.env.NEXT_PUBLIC_TERRAIN_SOURCE ??
    "aws") as TerrainSourceId;
  const key = configured === "proxy" ? "aws" : configured;
  const source = TERRAIN_SOURCES[key];
  return source && source.url ? source : TERRAIN_SOURCES.aws;
}

export function getTerrainSource(id?: string): TerrainSourceConfig {
  const key = (id ?? process.env.NEXT_PUBLIC_TERRAIN_SOURCE ?? "aws") as TerrainSourceId;
  const source = TERRAIN_SOURCES[key];

  if (!source || !source.url) {
    // A misconfigured custom source would otherwise fail as blank terrain with
    // no explanation; fall back loudly instead.
    if (key !== "aws") {
      console.warn(
        `[terrain] source "${key}" is unavailable or unconfigured; falling back to "aws".`,
      );
    }
    return TERRAIN_SOURCES.aws;
  }
  return source;
}

/**
 * Basemap raster used to skin the terrain.
 *
 * Hillshade over a hypsometric tint rather than satellite: it is free, needs no
 * key, works at every zoom, and a coloured route line reads far better against
 * neutral rock than against photographic texture.
 */
export const BASEMAP = {
  hillshade: {
    id: "hillshade",
    tiles: ["https://tiles.wmflabs.org/hillshading/{z}/{x}/{y}.png"],
    maxzoom: 14,
    attribution: "Hillshading: Wikimedia Labs / SRTM",
  },
  osm: {
    id: "osm",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
} as const;
