-- MountainMadness initial schema.
--
-- Hand-authored rather than emitted by `drizzle-kit generate`, for two reasons:
--
--   1. drizzle-kit does not emit CREATE EXTENSION, so a generated migration
--      cannot run on a fresh database: every geography column fails first.
--   2. drizzle-kit renders customType dataType strings as delimited
--      identifiers -- "geography(Point,4326)" -- which Postgres reads as a type
--      literally named `geography(Point,4326)`. Type modifiers are separate
--      grammar from the type name, so that form cannot resolve.
--
-- src/lib/db/schema.ts remains the typed query surface for Drizzle; this file
-- is the source of truth for DDL. Keep them in step by hand.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- canonical, shared
-- ---------------------------------------------------------------------------

CREATE TABLE "users" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "handle"       text NOT NULL,
  "display_name" text NOT NULL,
  "avatar_url"   text,
  "home_country" text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "users_handle_idx" ON "users" ("handle");

CREATE TABLE "peaks" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"         text NOT NULL,
  "name"         text NOT NULL,
  "alt_names"    text[],
  "location"     geography(Point, 4326) NOT NULL,
  "elevation_m"  integer,
  "prominence_m" integer,
  "country_code" text,
  "range_name"   text,
  "osm_id"       bigint,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "peaks_slug_idx" ON "peaks" ("slug");
CREATE UNIQUE INDEX "peaks_osm_id_idx" ON "peaks" ("osm_id");
CREATE INDEX "peaks_location_idx" ON "peaks" USING gist ("location");
CREATE INDEX "peaks_elevation_idx" ON "peaks" ("elevation_m");

CREATE TABLE "routes" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "peak_id"      uuid NOT NULL REFERENCES "peaks"("id") ON DELETE CASCADE,
  "slug"         text NOT NULL,
  "name"         text NOT NULL,
  "discipline"   text NOT NULL,
  "grade_system" text,
  "grade"        text,
  "vertical_m"   integer,
  "aspect_deg"   smallint,
  "season"       int4range,
  "description"  text,
  "geom"         geography(LineStringZ, 4326),
  "created_by"   uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "routes_peak_slug_idx" ON "routes" ("peak_id", "slug");
CREATE INDEX "routes_geom_idx" ON "routes" USING gist ("geom");

CREATE TABLE "route_revisions" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "route_id"   uuid NOT NULL REFERENCES "routes"("id") ON DELETE CASCADE,
  "edited_by"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "snapshot"   jsonb NOT NULL,
  "note"       text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "route_revisions_route_idx" ON "route_revisions" ("route_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- personal
-- ---------------------------------------------------------------------------

CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title"        text NOT NULL,
  "started_at"   timestamptz,
  "ended_at"     timestamptz,
  "peak_id"      uuid REFERENCES "peaks"("id") ON DELETE SET NULL,
  "outcome"      text,
  "highpoint_m"  integer,
  "conditions"   jsonb,
  "notes"        text,
  -- Private by default: a new user's first upload must not be public before
  -- they have decided that it should be.
  "visibility"   text NOT NULL DEFAULT 'private',
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trips_visibility_check"
    CHECK ("visibility" IN ('public', 'followers', 'private')),
  CONSTRAINT "trips_outcome_check"
    CHECK ("outcome" IS NULL OR "outcome" IN ('summit', 'highpoint', 'retreat', 'recon'))
);
CREATE INDEX "trips_user_started_idx" ON "trips" ("user_id", "started_at" DESC);
CREATE INDEX "trips_peak_public_idx" ON "trips" ("peak_id") WHERE "visibility" = 'public';

CREATE TABLE "trip_routes" (
  "trip_id"  uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "route_id" uuid NOT NULL REFERENCES "routes"("id") ON DELETE CASCADE,
  "sequence" smallint NOT NULL DEFAULT 0,
  "outcome"  text,
  PRIMARY KEY ("trip_id", "route_id")
);

CREATE TABLE "tracks" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trip_id"         uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "source"          text NOT NULL,
  "raw_blob_url"    text,
  "geom"            geography(LineStringZ, 4326),
  "geom_simple"     geography(LineStringZ, 4326),
  "bbox"            geography(Polygon, 4326),
  "distance_m"      integer,
  "gain_m"          integer,
  "loss_m"          integer,
  "duration_s"      integer,
  "moving_s"        integer,
  "started_at"      timestamptz,
  "profile"         jsonb,
  "privacy_start_m" integer NOT NULL DEFAULT 0,
  CONSTRAINT "tracks_source_check"
    CHECK ("source" IN ('gpx', 'fit', 'tcx', 'drawn'))
);
CREATE INDEX "tracks_trip_idx" ON "tracks" ("trip_id");
CREATE INDEX "tracks_geom_idx" ON "tracks" USING gist ("geom");
CREATE INDEX "tracks_bbox_idx" ON "tracks" USING gist ("bbox");

CREATE TABLE "media" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trip_id"        uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "blob_url"       text NOT NULL,
  "width"          integer,
  "height"         integer,
  "taken_at"       timestamptz,
  "location"       geography(Point, 4326),
  "track_offset_m" integer,
  "caption"        text
);
CREATE INDEX "media_trip_idx" ON "media" ("trip_id");
CREATE INDEX "media_location_idx" ON "media" USING gist ("location");

-- ---------------------------------------------------------------------------
-- social
-- ---------------------------------------------------------------------------

CREATE TABLE "follows" (
  "follower_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "followee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("follower_id", "followee_id"),
  CONSTRAINT "follows_no_self" CHECK ("follower_id" <> "followee_id")
);

CREATE TABLE "trip_reactions" (
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"    text NOT NULL,
  PRIMARY KEY ("trip_id", "user_id", "kind")
);

CREATE TABLE "comments" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trip_id"    uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "comments_trip_idx" ON "comments" ("trip_id", "created_at" DESC);
