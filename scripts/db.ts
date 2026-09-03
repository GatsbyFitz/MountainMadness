/**
 * Applies the schema to Neon and loads the seed snapshot into it.
 *
 *   npx tsx scripts/db.ts migrate   # CREATE EXTENSION + tables (idempotent-ish)
 *   npx tsx scripts/db.ts seed      # load src/lib/store/seed-data.json
 *   npx tsx scripts/db.ts status    # what is actually in there
 *
 * Uses Neon's HTTP driver, so it works anywhere HTTPS works — no TCP on 5432,
 * which many CI and sandbox networks block.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { neon } from "@neondatabase/serverless";

import { bboxToWkt, lineToWkt } from "../src/lib/store/postgres";
import type { Peak, Route, Track, Trip, User } from "../src/lib/store/types";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) first.");
  process.exit(1);
}
const sql = neon(url);

interface Snapshot {
  users: User[];
  peaks: Peak[];
  routes: Route[];
  trips: Trip[];
  tracks: Track[];
}

async function migrate() {
  const ddl = readFileSync(path.join(process.cwd(), "drizzle", "0000_init.sql"), "utf8");
  // The HTTP driver sends one statement per request, so split on the semicolons
  // that end a statement. Comments are stripped first so the ones containing
  // prose with semicolons cannot split a statement in half.
  const statements = ddl
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Applying ${statements.length} statements…`);
  for (const statement of statements) {
    try {
      await sql.query(statement);
    } catch (err) {
      const msg = (err as Error).message;
      // Re-running a migration should be boring, not fatal.
      if (/already exists/i.test(msg)) continue;
      console.error(`\nFailed: ${statement.slice(0, 90)}…\n  ${msg}`);
      throw err;
    }
  }
  console.log("Schema applied.");
}

async function seed() {
  const snapshot: Snapshot = JSON.parse(
    readFileSync(path.join(process.cwd(), "src", "lib", "store", "seed-data.json"), "utf8"),
  );

  // Seeding is a replace, not a merge: the snapshot is the source of truth and
  // a half-applied seed is worse than none.
  await sql`TRUNCATE tracks, trip_routes, trips, routes, peaks, users CASCADE`;

  for (const u of snapshot.users) {
    await sql`INSERT INTO users (id, handle, display_name, home_country)
              VALUES (${u.id}, ${u.handle}, ${u.displayName}, ${u.homeCountry})`;
  }
  for (const p of snapshot.peaks) {
    await sql`INSERT INTO peaks (id, slug, name, location, elevation_m, prominence_m,
                                 country_code, range_name)
              VALUES (${p.id}, ${p.slug}, ${p.name},
                      ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography,
                      ${p.elevationM}, ${p.prominenceM}, ${p.countryCode}, ${p.rangeName})`;
  }
  for (const r of snapshot.routes) {
    await sql`INSERT INTO routes (id, peak_id, slug, name, discipline, grade_system,
                                  grade, vertical_m, aspect_deg, description)
              VALUES (${r.id}, ${r.peakId}, ${r.slug}, ${r.name}, ${r.discipline},
                      ${r.gradeSystem}, ${r.grade}, ${r.verticalM}, ${r.aspectDeg},
                      ${r.description})`;
  }
  for (const t of snapshot.trips) {
    await sql`INSERT INTO trips (id, user_id, title, started_at, peak_id, outcome,
                                 highpoint_m, notes, visibility)
              VALUES (${t.id}, ${t.userId}, ${t.title}, ${t.startedAt}, ${t.peakId},
                      ${t.outcome}, ${t.highpointM}, ${t.notes}, ${t.visibility})`;
    for (const [i, routeId] of t.routeIds.entries()) {
      await sql`INSERT INTO trip_routes (trip_id, route_id, sequence)
                VALUES (${t.id}, ${routeId}, ${i})`;
    }
  }
  for (const tr of snapshot.tracks) {
    await sql`INSERT INTO tracks (id, trip_id, source, raw_blob_url, geom, geom_simple,
                                  bbox, distance_m, gain_m, loss_m, duration_s,
                                  moving_s, started_at, profile, privacy_start_m)
              VALUES (${tr.id}, ${tr.tripId}, ${tr.source}, ${tr.rawBlobUrl},
                      ST_GeomFromText(${lineToWkt(tr.line)}, 4326)::geography,
                      ST_GeomFromText(${lineToWkt(tr.line)}, 4326)::geography,
                      ST_GeomFromText(${bboxToWkt(tr.bbox)}, 4326)::geography,
                      ${tr.stats.distanceM}, ${tr.stats.gainM}, ${tr.stats.lossM},
                      ${tr.stats.durationS}, ${tr.stats.movingS}, ${tr.startedAt},
                      ${JSON.stringify(tr.profile)}::jsonb, ${tr.privacyStartM})`;
  }

  console.log(
    `Seeded ${snapshot.peaks.length} peaks, ${snapshot.routes.length} routes, ` +
      `${snapshot.trips.length} trips, ${snapshot.tracks.length} tracks.`,
  );
}

async function status() {
  const [v] = (await sql`SELECT postgis_version() AS v`) as { v: string }[];
  console.log("PostGIS:", v.v);
  for (const t of ["users", "peaks", "routes", "trips", "trip_routes", "tracks"]) {
    const [row] = (await sql.query(`SELECT count(*)::int AS n FROM ${t}`)) as { n: number }[];
    console.log(`  ${t.padEnd(12)} ${row.n}`);
  }
  const rows = (await sql`
    SELECT t.title, ST_NPoints(tk.geom_simple::geometry) AS pts, tk.gain_m
    FROM trips t JOIN tracks tk ON tk.trip_id = t.id ORDER BY t.started_at
  `) as { title: string; pts: number; gain_m: number }[];
  for (const r of rows) console.log(`  ${r.title} — ${r.pts} pts, +${r.gain_m}m`);
}

const cmd = process.argv[2];
const run = cmd === "migrate" ? migrate : cmd === "seed" ? seed : cmd === "status" ? status : null;
if (!run) {
  console.error("Usage: npx tsx scripts/db.ts <migrate|seed|status>");
  process.exit(1);
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
