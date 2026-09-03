import type { BBox } from "@/lib/geo/types";

export interface CameraView {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Initial compass bearing along the great circle from a to b, in degrees. */
export function bearingBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLon - aLon);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Zoom at which a bbox fills the viewport.
 *
 * Web Mercator: the world is `tileSize * 2^zoom` pixels wide, and latitude
 * spans compress toward the poles, so both axes are checked and the tighter
 * one wins.
 */
export function zoomForBBox(
  bbox: BBox,
  widthPx: number,
  heightPx: number,
  tileSize = 512,
  padding = 0.85,
): number {
  const lonSpan = Math.max(bbox.maxLon - bbox.minLon, 1e-6);

  const mercY = (lat: number) => {
    const clamped = Math.max(-85.05, Math.min(85.05, lat));
    return Math.log(Math.tan(Math.PI / 4 + toRad(clamped) / 2));
  };
  const latSpan = Math.max(Math.abs(mercY(bbox.maxLat) - mercY(bbox.minLat)), 1e-9);

  const zoomX = Math.log2((widthPx * 360) / (tileSize * lonSpan));
  const zoomY = Math.log2((heightPx * 2 * Math.PI) / (tileSize * latSpan));

  const zoom = Math.min(zoomX, zoomY) + Math.log2(padding);
  return Math.max(1, Math.min(18, zoom));
}

export interface FrameOptions {
  width?: number;
  height?: number;
  pitch?: number;
}

/**
 * Chooses an opening camera that looks *at* the face rather than at the back
 * of the mountain.
 *
 * The heuristic is the route's own fall line: place the camera on the low end
 * and aim it at the high end. A climbing route is photographed from below
 * because that is the side its features face, and using the track's own
 * geometry means it works without any terrain analysis.
 *
 * Falls back to looking north when the track has no usable elevation spread —
 * a flat loop has no face to look at.
 */
export function frameTrack(
  line: [number, number, number][],
  bbox: BBox,
  options: FrameOptions = {},
): CameraView {
  const { width = 1200, height = 800, pitch = 65 } = options;

  const centre = {
    longitude: (bbox.minLon + bbox.maxLon) / 2,
    latitude: (bbox.minLat + bbox.maxLat) / 2,
  };

  const base: CameraView = {
    ...centre,
    zoom: zoomForBBox(bbox, width, height),
    bearing: 0,
    pitch,
  };

  if (line.length < 2) return base;

  let low = line[0];
  let high = line[0];
  for (const p of line) {
    if (p[2] < low[2]) low = p;
    if (p[2] > high[2]) high = p;
  }

  const relief = high[2] - low[2];
  if (relief < 20) return base; // Nothing to look up at.

  const bearing = bearingBetween(low[1], low[0], high[1], high[0]);

  // A pitched camera pushes the map centre toward the top of the screen, so
  // bias the anchor down-route to keep the whole line in frame.
  const anchorLon = centre.longitude + (low[0] - centre.longitude) * 0.35;
  const anchorLat = centre.latitude + (low[1] - centre.latitude) * 0.35;

  return {
    longitude: anchorLon,
    latitude: anchorLat,
    // Pitching foreshortens the scene; back off slightly so the summit stays in view.
    zoom: zoomForBBox(bbox, width, height) - 0.6,
    bearing,
    pitch,
  };
}
