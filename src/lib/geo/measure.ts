import type { BBox } from "./types";

/** IUGG mean earth radius, metres. */
export const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS84 coordinates. */
export function haversine(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Projects lon/lat to local metres about an origin latitude. Accurate enough
 * for perpendicular-distance work inside a single track (tens of km), and far
 * cheaper than a real projection.
 */
export function toLocalMetres(
  lon: number,
  lat: number,
  originLat: number,
): [number, number] {
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLon = mPerDegLat * Math.cos(toRad(originLat));
  return [lon * mPerDegLon, lat * mPerDegLat];
}

export function bboxOf(points: { lat: number; lon: number }[]): BBox {
  if (points.length === 0) {
    throw new Error("bboxOf: no points");
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Pads a bbox by a fraction of its own span, with a metre-scale floor. */
export function padBBox(b: BBox, fraction = 0.12): BBox {
  const dLon = Math.max((b.maxLon - b.minLon) * fraction, 0.002);
  const dLat = Math.max((b.maxLat - b.minLat) * fraction, 0.002);
  return {
    minLon: b.minLon - dLon,
    minLat: b.minLat - dLat,
    maxLon: b.maxLon + dLon,
    maxLat: b.maxLat + dLat,
  };
}
