import type { StyleSpecification } from "maplibre-gl";

import type { TerrainSourceConfig } from "@/lib/geo/terrain";
import { BASEMAP } from "@/lib/tiles/sources";

/**
 * Hypsometric ramp, valley green to summit snow.
 *
 * Fed to MapLibre's `color-relief` layer, which reads the same DEM the terrain
 * mesh uses — so the skin costs no extra tiles. This is the plan's default
 * rather than satellite imagery: it needs no API key, works at every zoom, and
 * a coloured route line reads far better against neutral rock than against
 * photographic texture.
 */
const HYPSOMETRIC: [number, string][] = [
  [-500, "#1b3a52"], // below sea level: terrarium tiles carry bathymetry
  [0, "#2e5a3e"],
  [400, "#3f6b42"],
  [900, "#5c7c47"],
  [1400, "#8a8f55"],
  [1900, "#a08a5f"],
  [2400, "#9c8069"],
  [2900, "#8f7a72"],
  [3300, "#a09a97"],
  [3700, "#c4c2c4"],
  [4100, "#e2e4e8"],
  [4600, "#f5f8fb"],
];

function reliefRamp(): unknown[] {
  const stops: unknown[] = ["interpolate", ["linear"], ["elevation"]];
  for (const [elevation, color] of HYPSOMETRIC) stops.push(elevation, color);
  return stops;
}

export interface StyleOptions {
  terrain: TerrainSourceConfig;
  /** Swaps the hypsometric skin for satellite-ish OSM raster. */
  basemap?: "relief" | "osm";
  exaggeration?: number;
}

/**
 * Builds the map style.
 *
 * One DEM source drives three things at once: the 3D mesh via setTerrain, the
 * shading via `hillshade`, and the colour via `color-relief`. Sharing the
 * source is what keeps the tile count — and therefore the bill — down.
 */
export function buildStyle({
  terrain,
  basemap = "relief",
  exaggeration = 1.25,
}: StyleOptions): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      dem: {
        type: "raster-dem",
        tiles: [terrain.url],
        tileSize: terrain.tileSize,
        maxzoom: terrain.maxzoom,
        // Terrarium, not mapbox. The wrong value here produces a
        // plausible-looking but wrong mountain, with no error anywhere.
        encoding: terrain.encoding,
        attribution: terrain.attribution,
      },
    },
    layers: [
      {
        id: "sky-bg",
        type: "background",
        paint: { "background-color": "#0d1a24" },
      },
    ],
    terrain: { source: "dem", exaggeration },
    sky: {
      "sky-color": "#7fa9c9",
      "horizon-color": "#cfd9e0",
      "fog-color": "#b8c4cc",
      "fog-ground-blend": 0.5,
      "sky-horizon-blend": 0.6,
    },
  };

  if (basemap === "osm") {
    style.sources.basemap = {
      type: "raster",
      tiles: [...BASEMAP.osm.tiles],
      tileSize: 256,
      maxzoom: BASEMAP.osm.maxzoom,
      attribution: BASEMAP.osm.attribution,
    };
    style.layers.push({
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: { "raster-opacity": 1 },
    });
  } else {
    style.layers.push({
      id: "relief",
      type: "color-relief",
      source: "dem",
      paint: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "color-relief-color": reliefRamp() as any,
        "color-relief-opacity": 1,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  style.layers.push({
    id: "hillshade",
    type: "hillshade",
    source: "dem",
    paint: {
      "hillshade-exaggeration": 0.55,
      "hillshade-shadow-color": "#1c2b33",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#33414a",
      // Low sun from the north-west: the cartographic convention, and it makes
      // ridges and gullies legible rather than flat.
      "hillshade-illumination-direction": 315,
    },
  });

  return style;
}
