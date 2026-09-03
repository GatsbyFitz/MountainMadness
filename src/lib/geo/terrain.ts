/**
 * DEM sampling.
 *
 * Two encodings exist in the wild and they are not interchangeable. Declaring
 * the wrong one does not throw — it silently yields plausible-but-wrong
 * elevations, which is why `decodeElevation` is exhaustive over the union and
 * why the ingest pipeline asserts a known summit height in tests.
 */
export type TerrainEncoding = "terrarium" | "mapbox";

export function decodeElevation(
  r: number,
  g: number,
  b: number,
  encoding: TerrainEncoding,
): number {
  switch (encoding) {
    case "terrarium":
      // Mapzen/Tilezen: (R * 256 + G + B / 256) - 32768
      return r * 256 + g + b / 256 - 32768;
    case "mapbox":
      // Mapbox Terrain-RGB: -10000 + (R * 256^2 + G * 256 + B) * 0.1
      return -10000 + (r * 65536 + g * 256 + b) * 0.1;
  }
}

/** Slippy-map tile coordinates (may be fractional; floor for the tile index). */
export function lonLatToTile(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Ground resolution in metres per pixel, for choosing a sampling zoom. */
export function metresPerPixel(lat: number, z: number, tileSize: number): number {
  return (
    (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) /
    (tileSize * 2 ** z)
  );
}

export interface DemTile {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array | Uint8ClampedArray;
}

/**
 * Bilinear elevation lookup at a fractional pixel position within one tile.
 * Falls back to nearest-edge sampling at tile borders rather than reaching into
 * a neighbouring tile; the half-pixel error is far below DEM noise.
 */
export function bilinearSample(
  tile: DemTile,
  px: number,
  py: number,
  encoding: TerrainEncoding,
): number {
  const clampX = (v: number) => Math.max(0, Math.min(tile.width - 1, v));
  const clampY = (v: number) => Math.max(0, Math.min(tile.height - 1, v));

  const x0 = clampX(Math.floor(px));
  const y0 = clampY(Math.floor(py));
  const x1 = clampX(x0 + 1);
  const y1 = clampY(y0 + 1);
  const fx = px - Math.floor(px);
  const fy = py - Math.floor(py);

  const at = (x: number, y: number) => {
    const i = (y * tile.width + x) * 4;
    return decodeElevation(tile.data[i], tile.data[i + 1], tile.data[i + 2], encoding);
  };

  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export interface TerrainSourceConfig {
  id: string;
  /** Tile URL template with {z}/{x}/{y}. */
  url: string;
  encoding: TerrainEncoding;
  tileSize: number;
  maxzoom: number;
  attribution: string;
}

export type TileFetcher = (url: string) => Promise<DemTile | null>;

/**
 * Samples DEM elevation for a batch of coordinates.
 *
 * Batched by tile on purpose: a track covers a handful of tiles, and fetching
 * per point would be thousands of requests for the same few images.
 * A tile that fails to load yields null for its points rather than failing the
 * whole ingest — a track with no terrain data is still a track.
 */
export async function sampleElevations(
  coords: { lat: number; lon: number }[],
  source: TerrainSourceConfig,
  fetchTile: TileFetcher,
  zoom?: number,
): Promise<(number | null)[]> {
  if (coords.length === 0) return [];

  const z = Math.min(zoom ?? source.maxzoom, source.maxzoom);
  const out = new Array<number | null>(coords.length).fill(null);

  // Group point indices by the tile they land in.
  const byTile = new Map<string, number[]>();
  const tileOf = new Map<string, { x: number; y: number }>();

  for (let i = 0; i < coords.length; i++) {
    const { x, y } = lonLatToTile(coords[i].lon, coords[i].lat, z);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const key = `${tx}/${ty}`;
    if (!byTile.has(key)) {
      byTile.set(key, []);
      tileOf.set(key, { x: tx, y: ty });
    }
    byTile.get(key)!.push(i);
  }

  for (const [key, indices] of byTile) {
    const { x: tx, y: ty } = tileOf.get(key)!;
    const url = source.url
      .replace("{z}", String(z))
      .replace("{x}", String(tx))
      .replace("{y}", String(ty));

    const tile = await fetchTile(url);
    if (!tile) continue;

    for (const i of indices) {
      const { x, y } = lonLatToTile(coords[i].lon, coords[i].lat, z);
      const px = (x - tx) * tile.width;
      const py = (y - ty) * tile.height;
      out[i] = bilinearSample(tile, px, py, source.encoding);
    }
  }

  return out;
}

/**
 * Render height for a route vertex.
 *
 * On a steep face, horizontal DEM error becomes vertical error of the same
 * magnitude, so a track drawn at its true GPS altitude sinks into the mesh and
 * disappears. Lifting to the terrain surface plus a clearance keeps the whole
 * line visible; both values are stored so the profile chart can still show the
 * honest GPS elevation.
 */
export function renderHeight(
  gpsZ: number | null,
  demZ: number | null,
  clearanceM = 15,
): number {
  if (demZ === null) return gpsZ ?? 0;
  if (gpsZ === null) return demZ + clearanceM;
  return Math.max(gpsZ, demZ + clearanceM);
}
