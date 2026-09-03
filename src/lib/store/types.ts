import type { BBox, ProfilePoint, TrackStats } from "@/lib/geo/types";

export interface Peak {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  prominenceM: number | null;
  countryCode: string | null;
  rangeName: string | null;
}

export interface Route {
  id: string;
  peakId: string;
  slug: string;
  name: string;
  discipline: string;
  gradeSystem: string | null;
  grade: string | null;
  verticalM: number | null;
  aspectDeg: number | null;
  description: string | null;
}

export type Visibility = "public" | "followers" | "private";
export type Outcome = "summit" | "highpoint" | "retreat" | "recon";

export interface Trip {
  id: string;
  userId: string;
  title: string;
  startedAt: string | null;
  peakId: string | null;
  routeIds: string[];
  outcome: Outcome | null;
  highpointM: number | null;
  notes: string | null;
  visibility: Visibility;
  createdAt: string;
}

export interface Track {
  id: string;
  tripId: string;
  source: "gpx" | "fit" | "tcx" | "drawn";
  rawBlobUrl: string | null;
  /** Simplified [lon, lat, renderZ] vertices — what the viewer downloads. */
  line: [number, number, number][];
  bbox: BBox;
  stats: TrackStats;
  profile: ProfilePoint[];
  privacyStartM: number;
  startedAt: string | null;
  /** True when DEM sampling succeeded, so the viewer knows heights are clamped. */
  demSampled: boolean;
}

export interface User {
  id: string;
  handle: string;
  displayName: string;
  homeCountry: string | null;
}

/**
 * The storage seam.
 *
 * The app talks only to this interface. `LocalStore` (JSON on disk) is what
 * runs with no cloud credentials; a Postgres/PostGIS implementation slots in
 * behind the same shape once DATABASE_URL exists.
 */
export interface Store {
  listPeaks(): Promise<Peak[]>;
  getPeak(id: string): Promise<Peak | null>;
  getPeakBySlug(slug: string): Promise<Peak | null>;

  listRoutesForPeak(peakId: string): Promise<Route[]>;
  getRoute(id: string): Promise<Route | null>;

  listTrips(opts?: { visibility?: Visibility; peakId?: string }): Promise<Trip[]>;
  getTrip(id: string): Promise<Trip | null>;
  createTrip(trip: Omit<Trip, "id" | "createdAt">): Promise<Trip>;
  updateTrip(id: string, patch: Partial<Trip>): Promise<Trip | null>;

  getTrackByTrip(tripId: string): Promise<Track | null>;
  saveTrack(track: Omit<Track, "id">): Promise<Track>;

  getUser(id: string): Promise<User | null>;
  getUserByHandle(handle: string): Promise<User | null>;
}
