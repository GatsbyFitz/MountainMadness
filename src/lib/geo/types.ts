/** A single sample from a GPS device, before any processing. */
export interface RawPoint {
  lat: number;
  lon: number;
  /** Device-reported elevation in metres. Barometric or GNSS; both are noisy. */
  ele: number | null;
  /** Epoch milliseconds. Null for tracks recorded without timestamps. */
  t: number | null;
  hr?: number | null;
}

/** A point after cleaning, with terrain elevation sampled alongside the GPS value. */
export interface TrackPoint extends RawPoint {
  /** Elevation read from the DEM at this coordinate. Null if sampling failed. */
  demZ: number | null;
  /** Cumulative distance from the track start, in metres. */
  d: number;
}

export interface TrackStats {
  distanceM: number;
  gainM: number;
  lossM: number;
  /** Wall-clock seconds from first to last sample. Null for untimed tracks. */
  durationS: number | null;
  /** Seconds excluding stops and gaps. Null for untimed tracks. */
  movingS: number | null;
  minEleM: number | null;
  maxEleM: number | null;
  /** Steepest sustained grade as a fraction (0.5 = 50%). */
  maxGrade: number | null;
}

/** One sample of the elevation profile chart, resampled to even spacing. */
export interface ProfilePoint {
  /** Distance along the track, metres. */
  d: number;
  /** Smoothed GPS elevation. */
  z: number;
  /** DEM elevation at the same place, for comparison. */
  demZ: number | null;
  /** Epoch ms, interpolated. */
  t: number | null;
}

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Everything the ingest pipeline derives from one uploaded file. */
export interface IngestedTrack {
  points: TrackPoint[];
  /** Simplified positions for the viewer: [lon, lat, renderZ][]. */
  line: [number, number, number][];
  stats: TrackStats;
  profile: ProfilePoint[];
  bbox: BBox;
  startedAt: number | null;
  /** Metres trimmed from each end for privacy. */
  privacyStartM: number;
}
