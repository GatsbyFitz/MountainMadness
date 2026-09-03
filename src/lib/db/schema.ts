import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * PostGIS geography columns.
 *
 * Drizzle's built-in geometry type only covers points, and this schema needs
 * LineStringZ (a route carries elevation per vertex, which is the whole point).
 * A custom type keeps the DDL honest and leaves reads/writes as WKT, which is
 * what ST_GeomFromText and ST_AsText speak.
 */
const geography = (kind: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geography(${kind},4326)`,
  });

const point = geography("Point");
const lineStringZ = geography("LineStringZ");
const polygon = geography("Polygon");

// ---------------------------------------------------------------------------
// canonical, shared
// ---------------------------------------------------------------------------

export const peaks = pgTable(
  "peaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    altNames: text("alt_names").array(),
    location: point("location").notNull(),
    elevationM: integer("elevation_m"),
    prominenceM: integer("prominence_m"),
    countryCode: text("country_code"),
    rangeName: text("range_name"),
    osmId: integer("osm_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("peaks_slug_idx").on(t.slug),
    uniqueIndex("peaks_osm_id_idx").on(t.osmId),
    index("peaks_location_idx").using("gist", t.location),
    index("peaks_elevation_idx").on(t.elevationM),
  ],
);

export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    peakId: uuid("peak_id")
      .references(() => peaks.id, { onDelete: "cascade" })
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** hike | scramble | alpine | rock | ice | ski | mixed */
    discipline: text("discipline").notNull(),
    /** yds | uiaa | french | alaska | scottish | ... */
    gradeSystem: text("grade_system"),
    grade: text("grade"),
    verticalM: integer("vertical_m"),
    aspectDeg: smallint("aspect_deg"),
    description: text("description"),
    geom: lineStringZ("geom"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("routes_peak_slug_idx").on(t.peakId, t.slug),
    index("routes_geom_idx").using("gist", t.geom),
  ],
);

/** Append-only edit history, so a shared registry can be corrected safely. */
export const routeRevisions = pgTable("route_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeId: uuid("route_id")
    .references(() => routes.id, { onDelete: "cascade" })
    .notNull(),
  editedBy: uuid("edited_by").references(() => users.id, { onDelete: "set null" }),
  /** Full snapshot of the route row as it was after this edit. */
  snapshot: jsonb("snapshot").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// personal
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    homeCountry: text("home_country"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_handle_idx").on(t.handle)],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    peakId: uuid("peak_id").references(() => peaks.id, { onDelete: "set null" }),
    /** summit | highpoint | retreat | recon */
    outcome: text("outcome"),
    highpointM: integer("highpoint_m"),
    conditions: jsonb("conditions"),
    notes: text("notes"),
    /** public | followers | private — private is the default for new users. */
    visibility: text("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("trips_user_started_idx").on(t.userId, t.startedAt.desc()),
    // Partial index: the explore surface only ever reads public trips.
    index("trips_peak_public_idx")
      .on(t.peakId)
      .where(sql`${t.visibility} = 'public'`),
  ],
);

export const tripRoutes = pgTable(
  "trip_routes",
  {
    tripId: uuid("trip_id")
      .references(() => trips.id, { onDelete: "cascade" })
      .notNull(),
    routeId: uuid("route_id")
      .references(() => routes.id, { onDelete: "cascade" })
      .notNull(),
    sequence: smallint("sequence").notNull().default(0),
    outcome: text("outcome"),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.routeId] })],
);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .references(() => trips.id, { onDelete: "cascade" })
      .notNull(),
    /** gpx | fit | tcx | drawn */
    source: text("source").notNull(),
    /** The original upload, kept immutable so ingest can be re-run after fixes. */
    rawBlobUrl: text("raw_blob_url"),
    geom: lineStringZ("geom"),
    /** ~3k vertices: what the viewer downloads. */
    geomSimple: lineStringZ("geom_simple"),
    bbox: polygon("bbox"),
    distanceM: integer("distance_m"),
    gainM: integer("gain_m"),
    lossM: integer("loss_m"),
    durationS: integer("duration_s"),
    movingS: integer("moving_s"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Resampled elevation profile, ~500 points. */
    profile: jsonb("profile"),
    /**
     * Metres trimmed from each end before the geometry left the server.
     * Enforced at ingest, not at render: a client-side privacy control is not
     * a privacy control.
     */
    privacyStartM: integer("privacy_start_m").notNull().default(0),
  },
  (t) => [
    index("tracks_trip_idx").on(t.tripId),
    index("tracks_geom_idx").using("gist", t.geom),
    index("tracks_bbox_idx").using("gist", t.bbox),
  ],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .references(() => trips.id, { onDelete: "cascade" })
      .notNull(),
    blobUrl: text("blob_url").notNull(),
    width: integer("width"),
    height: integer("height"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    location: point("location"),
    /** Where along the track this photo was taken, for the flyover. */
    trackOffsetM: integer("track_offset_m"),
    caption: text("caption"),
  },
  (t) => [index("media_trip_idx").on(t.tripId)],
);

// ---------------------------------------------------------------------------
// social
// ---------------------------------------------------------------------------

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    followeeId: uuid("followee_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] })],
);

export const tripReactions = pgTable(
  "trip_reactions",
  {
    tripId: uuid("trip_id")
      .references(() => trips.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId, t.kind] })],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .references(() => trips.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("comments_trip_idx").on(t.tripId)],
);
