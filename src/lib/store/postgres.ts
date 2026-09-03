import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import type { BBox, ProfilePoint, TrackStats } from "@/lib/geo/types";
import type { Peak, Route, Store, Track, Trip, User, Visibility } from "./types";

/**
 * PostGIS-backed store, over Neon's HTTP driver.
 *
 * HTTP rather than a TCP pool on purpose: Vercel Functions are short-lived and
 * a connection pool per invocation is the classic way to exhaust a database's
 * connection limit. The HTTP endpoint is stateless and needs no pooling.
 *
 * Geometry crosses the boundary as WKT. The app speaks `[lon, lat, z][]`, the
 * column is `geography(LineStringZ,4326)`, and ST_GeomFromText / ST_AsText are
 * the translation. Keeping that conversion in one file means nothing else has
 * to know the column is not plain JSON.
 */

type Sql = NeonQueryFunction<false, false>;

/** `[lon, lat, z][]` -> `LINESTRING Z (lon lat z, ...)`. */
export function lineToWkt(line: [number, number, number][]): string {
  if (line.length < 2) throw new Error("A LineString needs at least two points.");
  const pts = line.map(([lon, lat, z]) => `${lon} ${lat} ${z}`).join(",");
  return `LINESTRING Z (${pts})`;
}

/** `LINESTRING Z (...)` -> `[lon, lat, z][]`. Tolerates the ZM/2D spellings. */
export function wktToLine(wkt: string): [number, number, number][] {
  const inner = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
  return inner
    .split(",")
    .map((pair) => {
      const [lon, lat, z] = pair.trim().split(/\s+/).map(Number);
      return [lon, lat, Number.isFinite(z) ? z : 0] as [number, number, number];
    })
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

export function bboxToWkt(b: BBox): string {
  const { minLon, minLat, maxLon, maxLat } = b;
  return (
    `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},` +
    `${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`
  );
}

export function wktToBBox(wkt: string): BBox {
  const inner = wkt.slice(wkt.indexOf("((") + 2, wkt.indexOf("))"));
  const pts = inner.split(",").map((p) => p.trim().split(/\s+/).map(Number));
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return {
    minLon: Math.min(...lons),
    minLat: Math.min(...lats),
    maxLon: Math.max(...lons),
    maxLat: Math.max(...lats),
  };
}

// --- row shapes -------------------------------------------------------------

interface PeakRow {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  prominence_m: number | null;
  country_code: string | null;
  range_name: string | null;
}

const toPeak = (r: PeakRow): Peak => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  lat: Number(r.lat),
  lon: Number(r.lon),
  elevationM: r.elevation_m,
  prominenceM: r.prominence_m,
  countryCode: r.country_code,
  rangeName: r.range_name,
});

/** Peaks always come back with the geography decomposed into lat/lon. */
const PEAK_COLUMNS = `id, slug, name,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
  elevation_m, prominence_m, country_code, range_name`;

export class PostgresStore implements Store {
  private sql: Sql;

  constructor(connectionString: string) {
    this.sql = neon(connectionString) as Sql;
  }

  // --- peaks ----------------------------------------------------------------

  async listPeaks(): Promise<Peak[]> {
    const rows = (await this.sql`
      SELECT ${this.sql.unsafe(PEAK_COLUMNS)} FROM peaks
      ORDER BY elevation_m DESC NULLS LAST
    `) as PeakRow[];
    return rows.map(toPeak);
  }

  async getPeak(id: string): Promise<Peak | null> {
    const rows = (await this.sql`
      SELECT ${this.sql.unsafe(PEAK_COLUMNS)} FROM peaks WHERE id = ${id}
    `) as PeakRow[];
    return rows[0] ? toPeak(rows[0]) : null;
  }

  async getPeakBySlug(slug: string): Promise<Peak | null> {
    const rows = (await this.sql`
      SELECT ${this.sql.unsafe(PEAK_COLUMNS)} FROM peaks WHERE slug = ${slug}
    `) as PeakRow[];
    return rows[0] ? toPeak(rows[0]) : null;
  }

  // --- routes ---------------------------------------------------------------

  async listRoutesForPeak(peakId: string): Promise<Route[]> {
    const rows = (await this.sql`
      SELECT id, peak_id, slug, name, discipline, grade_system, grade,
             vertical_m, aspect_deg, description
      FROM routes WHERE peak_id = ${peakId} ORDER BY name
    `) as Record<string, never>[];
    return rows.map(this.toRoute);
  }

  async getRoute(id: string): Promise<Route | null> {
    const rows = (await this.sql`
      SELECT id, peak_id, slug, name, discipline, grade_system, grade,
             vertical_m, aspect_deg, description
      FROM routes WHERE id = ${id}
    `) as Record<string, never>[];
    return rows[0] ? this.toRoute(rows[0]) : null;
  }

  private toRoute = (r: Record<string, unknown>): Route => ({
    id: r.id as string,
    peakId: r.peak_id as string,
    slug: r.slug as string,
    name: r.name as string,
    discipline: r.discipline as string,
    gradeSystem: (r.grade_system as string) ?? null,
    grade: (r.grade as string) ?? null,
    verticalM: (r.vertical_m as number) ?? null,
    aspectDeg: (r.aspect_deg as number) ?? null,
    description: (r.description as string) ?? null,
  });

  // --- trips ----------------------------------------------------------------

  private toTrip = (r: Record<string, unknown>): Trip => ({
    id: r.id as string,
    userId: r.user_id as string,
    title: r.title as string,
    startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
    peakId: (r.peak_id as string) ?? null,
    routeIds: (r.route_ids as string[]) ?? [],
    outcome: (r.outcome as Trip["outcome"]) ?? null,
    highpointM: (r.highpoint_m as number) ?? null,
    notes: (r.notes as string) ?? null,
    visibility: r.visibility as Visibility,
    createdAt: new Date(r.created_at as string).toISOString(),
  });

  /** trip_routes is a join table; collapse it so callers see a plain array. */
  private readonly TRIP_COLUMNS = `t.id, t.user_id, t.title, t.started_at, t.peak_id,
    t.outcome, t.highpoint_m, t.notes, t.visibility, t.created_at,
    COALESCE(
      (SELECT array_agg(tr.route_id ORDER BY tr.sequence) FROM trip_routes tr WHERE tr.trip_id = t.id),
      ARRAY[]::uuid[]
    ) AS route_ids`;

  async listTrips(opts: { visibility?: Visibility; peakId?: string } = {}): Promise<Trip[]> {
    const rows = (await this.sql`
      SELECT ${this.sql.unsafe(this.TRIP_COLUMNS)} FROM trips t
      WHERE (${opts.visibility ?? null}::text IS NULL OR t.visibility = ${opts.visibility ?? null})
        AND (${opts.peakId ?? null}::uuid IS NULL OR t.peak_id = ${opts.peakId ?? null})
      ORDER BY t.started_at DESC NULLS LAST, t.created_at DESC
    `) as Record<string, never>[];
    return rows.map(this.toTrip);
  }

  async getTrip(id: string): Promise<Trip | null> {
    const rows = (await this.sql`
      SELECT ${this.sql.unsafe(this.TRIP_COLUMNS)} FROM trips t WHERE t.id = ${id}
    `) as Record<string, never>[];
    return rows[0] ? this.toTrip(rows[0]) : null;
  }

  async createTrip(trip: Omit<Trip, "id" | "createdAt">): Promise<Trip> {
    const rows = (await this.sql`
      INSERT INTO trips (user_id, title, started_at, peak_id, outcome,
                         highpoint_m, notes, visibility)
      VALUES (${trip.userId}, ${trip.title}, ${trip.startedAt}, ${trip.peakId},
              ${trip.outcome}, ${trip.highpointM}, ${trip.notes}, ${trip.visibility})
      RETURNING id, created_at
    `) as { id: string; created_at: string }[];

    const id = rows[0].id;
    for (const [i, routeId] of trip.routeIds.entries()) {
      await this.sql`
        INSERT INTO trip_routes (trip_id, route_id, sequence)
        VALUES (${id}, ${routeId}, ${i})
        ON CONFLICT (trip_id, route_id) DO NOTHING
      `;
    }
    return { ...trip, id, createdAt: new Date(rows[0].created_at).toISOString() };
  }

  async updateTrip(id: string, patch: Partial<Trip>): Promise<Trip | null> {
    // COALESCE keeps every unset field at its current value, so a partial patch
    // cannot blank a column it did not mention.
    await this.sql`
      UPDATE trips SET
        title      = COALESCE(${patch.title ?? null}, title),
        outcome    = COALESCE(${patch.outcome ?? null}, outcome),
        notes      = COALESCE(${patch.notes ?? null}, notes),
        visibility = COALESCE(${patch.visibility ?? null}, visibility),
        peak_id    = COALESCE(${patch.peakId ?? null}::uuid, peak_id),
        updated_at = now()
      WHERE id = ${id}
    `;
    return this.getTrip(id);
  }

  // --- tracks ---------------------------------------------------------------

  async getTrackByTrip(tripId: string): Promise<Track | null> {
    const rows = (await this.sql`
      SELECT id, trip_id, source, raw_blob_url,
             ST_AsText(geom_simple::geometry) AS line_wkt,
             ST_AsText(bbox::geometry)        AS bbox_wkt,
             distance_m, gain_m, loss_m, duration_s, moving_s,
             started_at, profile, privacy_start_m
      FROM tracks WHERE trip_id = ${tripId} LIMIT 1
    `) as Record<string, never>[];
    if (!rows[0]) return null;

    const r = rows[0] as Record<string, unknown>;
    const profile = (r.profile as ProfilePoint[] | null) ?? [];
    const stats: TrackStats = {
      distanceM: (r.distance_m as number) ?? 0,
      gainM: (r.gain_m as number) ?? 0,
      lossM: (r.loss_m as number) ?? 0,
      durationS: (r.duration_s as number) ?? null,
      movingS: (r.moving_s as number) ?? null,
      minEleM: profile.length ? Math.round(Math.min(...profile.map((p) => p.z))) : null,
      maxEleM: profile.length ? Math.round(Math.max(...profile.map((p) => p.z))) : null,
      maxGrade: null,
    };

    return {
      id: r.id as string,
      tripId: r.trip_id as string,
      source: r.source as Track["source"],
      rawBlobUrl: (r.raw_blob_url as string) ?? null,
      line: wktToLine(r.line_wkt as string),
      bbox: wktToBBox(r.bbox_wkt as string),
      stats,
      profile,
      privacyStartM: (r.privacy_start_m as number) ?? 0,
      startedAt: r.started_at ? new Date(r.started_at as string).toISOString() : null,
      // A stored track was DEM-sampled iff its profile carries terrain heights.
      demSampled: profile.some((p) => p.demZ !== null),
    };
  }

  async saveTrack(track: Omit<Track, "id">): Promise<Track> {
    const rows = (await this.sql`
      INSERT INTO tracks (trip_id, source, raw_blob_url, geom, geom_simple, bbox,
                          distance_m, gain_m, loss_m, duration_s, moving_s,
                          started_at, profile, privacy_start_m)
      VALUES (
        ${track.tripId}, ${track.source}, ${track.rawBlobUrl},
        ST_GeomFromText(${lineToWkt(track.line)}, 4326)::geography,
        ST_GeomFromText(${lineToWkt(track.line)}, 4326)::geography,
        ST_GeomFromText(${bboxToWkt(track.bbox)}, 4326)::geography,
        ${track.stats.distanceM}, ${track.stats.gainM}, ${track.stats.lossM},
        ${track.stats.durationS}, ${track.stats.movingS},
        ${track.startedAt}, ${JSON.stringify(track.profile)}::jsonb,
        ${track.privacyStartM}
      )
      RETURNING id
    `) as { id: string }[];
    return { ...track, id: rows[0].id };
  }

  // --- users ----------------------------------------------------------------

  private toUser = (r: Record<string, unknown>): User => ({
    id: r.id as string,
    handle: r.handle as string,
    displayName: r.display_name as string,
    homeCountry: (r.home_country as string) ?? null,
  });

  async getUser(id: string): Promise<User | null> {
    const rows = (await this.sql`
      SELECT id, handle, display_name, home_country FROM users WHERE id = ${id}
    `) as Record<string, never>[];
    return rows[0] ? this.toUser(rows[0]) : null;
  }

  async getUserByHandle(handle: string): Promise<User | null> {
    const rows = (await this.sql`
      SELECT id, handle, display_name, home_country FROM users WHERE handle = ${handle}
    `) as Record<string, never>[];
    return rows[0] ? this.toUser(rows[0]) : null;
  }
}
