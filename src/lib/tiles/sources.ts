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
 * Raster skins draped over the terrain mesh.
 *
 * `relief` is generated from the DEM we already load, so it costs no extra
 * tiles and needs no key — the sane default, and the one a coloured route line
 * reads best against. The rest are real imagery for when you want to see the
 * actual glacier, rock band or tree line, and all go through /api/raster so
 * they are edge-cached and carry no vendor key in the client bundle.
 */
export interface RasterLayerConfig {
  id: string;
  label: string;
  /** Upstream template. Note the ArcGIS {y}/{x} ordering — it is not a typo. */
  url: string;
  maxzoom: number;
  attribution: string;
  /** Shown in the viewer so the source of what you are looking at is legible. */
  note?: string;
}

export type RasterLayerId = "satellite" | "topo" | "osm";

export const RASTER_LAYERS: Record<RasterLayerId, RasterLayerConfig> = {
  satellite: {
    id: "satellite",
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    note: "Highest detail. Best for seeing the actual glacier and rock.",
  },
  topo: {
    id: "topo",
    label: "Topo",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution:
      '&copy; <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA), ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    note: "Contours, huts and trails — closest to a paper map.",
  },
  osm: {
    id: "osm",
    label: "Map",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxzoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

/** Everything the viewer can drape, including the DEM-generated relief. */
export const SKINS = ["relief", "satellite", "topo", "osm"] as const;
export type SkinId = (typeof SKINS)[number];

export function getRasterLayer(id: string): RasterLayerConfig | null {
  return (RASTER_LAYERS as Record<string, RasterLayerConfig>)[id] ?? null;
}
