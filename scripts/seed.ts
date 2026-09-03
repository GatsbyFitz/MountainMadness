/**
 * Seeds the store from the Notion mountain diaries.
 *
 * For each climb in scripts/climbs.ts: snaps the waypoints to the DEM,
 * densifies the polyline, builds a GPX, and pushes it through the same ingest
 * pipeline a real upload uses — so the demo data and user data go through
 * identical code, including the height clamp and the stats.
 *
 * Writes the local JSON store and the committed snapshot the app falls back to
 * on a read-only host.
 *
 *   npx tsx scripts/seed.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { fetchDemTile } from "../src/lib/geo/fetch-tile";
import { haversine } from "../src/lib/geo/measure";
import { ingestGpx } from "../src/lib/geo/pipeline";
import { snapToTerrain } from "../src/lib/geo/snap";
import { LocalStore } from "../src/lib/store/local";
import type { Peak, Route, Track, Trip, User } from "../src/lib/store/types";
import { TERRAIN_SOURCES } from "../src/lib/tiles/sources";
import { CLIMBS, type ClimbSeed, type Waypoint } from "./climbs";

const SOURCE = TERRAIN_SOURCES.aws;
const USER_ID = "00000000-0000-4000-8000-000000000001";

/** Stable ids so re-seeding does not churn the snapshot. */
const id = (kind: string, n: number) =>
  `00000000-0000-4000-8000-${String(kind.length * 100 + n).padStart(12, "0")}`;

function densify(pts: { lat: number; lon: number }[], spacingM: number) {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const steps = Math.max(1, Math.round(haversine(a.lat, a.lon, b.lat, b.lon) / spacingM));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Waypoints whose snapped elevation misses the published figure by more than
 * this are treated as bad coordinates and dropped from the route.
 *
 * Snapping corrects a point that is roughly right; it cannot rescue one that is
 * in the wrong valley. A waypoint reading 878m above its published elevation is
 * not a hut at 460m, and stitching it into the line would invent terrain the
 * party never crossed. Dropping it shortens the route honestly instead.
 */
const ELEVATION_TOLERANCE_M = 90;

async function snapWaypoints(climb: ClimbSeed): Promise<Waypoint[]> {
  const out: Waypoint[] = [];
  for (const w of climb.waypoints) {
    if (!w.snap) {
      out.push(w);
      continue;
    }
    const snapped = await snapToTerrain(w, {
      mode: w.snap,
      radiusDeg: w.radius ?? 0.01,
      targetEle: w.ele ?? 0,
      maxMoveM: w.maxMoveM ?? 400,
      source: SOURCE,
      fetchTile: fetchDemTile,
    });
    if (!snapped) {
      console.warn(`    ${w.name}: no DEM coverage, keeping the guess`);
      out.push(w);
      continue;
    }
    const vsPublished = w.ele === undefined ? null : snapped.ele - w.ele;
    // A summit is allowed to read low: a coarse DEM cannot hold a sharp peak.
    const tolerance = w.snap === "max" ? 250 : ELEVATION_TOLERANCE_M;
    const rejected = vsPublished !== null && Math.abs(vsPublished) > tolerance;

    console.log(
      `    ${rejected ? "DROP " : "     "}${w.name.padEnd(26)} ${snapped.ele.toFixed(0).padStart(5)}m` +
        (vsPublished === null ? "" : ` (pub ${w.ele}, ${vsPublished >= 0 ? "+" : ""}${vsPublished.toFixed(0)})`),
    );
    if (rejected) continue;
    out.push({ ...w, lat: snapped.lat, lon: snapped.lon });
  }
  return out;
}

/**
 * Builds a GPX from the snapped waypoints.
 *
 * Elevation comes from the DEM rather than being invented, and the timestamps
 * model a plausible pace that slows with altitude — enough for moving time and
 * grade to be meaningful, without pretending to be a recording.
 */
async function buildGpx(climb: ClimbSeed, waypoints: Waypoint[]): Promise<string> {
  const spine = densify(waypoints, 25);
  const { sampleElevations } = await import("../src/lib/geo/terrain");
  const dem = await sampleElevations(spine, SOURCE, fetchDemTile, 13);

  const rand = mulberry32(climb.peak.slug.length * 7919);
  let clock = Date.parse(`${climb.trip.startedAt}T04:30:00Z`);

  const rows = spine.map((p, i) => {
    const ground = dem[i] ?? 1000;
    const ele = ground + 1.5 + (rand() - 0.5) * 4;
    const altitudeFactor = 1 + Math.max(0, (ground - 1500) / 1500);
    clock += Math.round(16 * altitudeFactor + rand() * 8) * 1000;
    return {
      lat: p.lat + (rand() - 0.5) * 0.00003,
      lon: p.lon + (rand() - 0.5) * 0.00004,
      ele,
      time: new Date(clock).toISOString(),
    };
  });

  const trkpts = rows
    .map(
      (r) =>
        `      <trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}">` +
        `<ele>${r.ele.toFixed(1)}</ele><time>${r.time}</time></trkpt>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MountainMadness seed (approximate, from waypoints)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${climb.trip.title}</name></metadata>
  <trk><name>${climb.route.name}</name><trkseg>
${trkpts}
  </trkseg></trk>
</gpx>
`;
}

async function main() {
  const users: User[] = [
    { id: USER_ID, handle: "gatsby", displayName: "Gatsby Fitzgerald", homeCountry: "AU" },
  ];
  const peaks: Peak[] = [];
  const routes: Route[] = [];
  const trips: Trip[] = [];
  const tracks: Track[] = [];

  const demoDir = path.join(process.cwd(), "public", "demo");
  await mkdir(demoDir, { recursive: true });

  for (const [i, climb] of CLIMBS.entries()) {
    console.log(`\n${climb.trip.title}`);
    console.log("  snapping waypoints to terrain…");
    const waypoints = await snapWaypoints(climb);
    if (waypoints.length < 2) {
      console.warn(`  SKIPPED: only ${waypoints.length} verified waypoint(s).`);
      continue;
    }
    if (waypoints.length < climb.waypoints.length) {
      console.log(
        `  note: ${climb.waypoints.length - waypoints.length} unverified waypoint(s) dropped; ` +
          `route starts at "${waypoints[0].name}".`,
      );
    }

    const gpx = await buildGpx(climb, waypoints);
    const file = `${climb.peak.slug}-${climb.route.slug}.gpx`;
    await writeFile(path.join(demoDir, file), gpx, "utf8");

    const result = await ingestGpx(gpx, {
      targetPoints: 3000,
      profileSamples: 500,
      terrain: { source: SOURCE, fetchTile: fetchDemTile },
    });

    const peakId = id("peak", i);
    const routeId = id("route", i);
    const tripId = id("trip", i);

    // The summit is the last waypoint for a summit trip; for a highpoint trip
    // it is the peak's own published position, which the party did not reach.
    peaks.push({
      id: peakId,
      slug: climb.peak.slug,
      name: climb.peak.name,
      lat: climb.peak.lat,
      lon: climb.peak.lon,
      elevationM: climb.peak.elevationM,
      prominenceM: climb.peak.prominenceM,
      countryCode: climb.peak.countryCode,
      rangeName: climb.peak.rangeName,
    });

    routes.push({
      id: routeId,
      peakId,
      slug: climb.route.slug,
      name: climb.route.name,
      discipline: climb.route.discipline,
      gradeSystem: climb.route.gradeSystem,
      grade: climb.route.grade,
      verticalM: climb.route.verticalM,
      aspectDeg: climb.route.aspectDeg,
      description: climb.route.description,
    });

    trips.push({
      id: tripId,
      userId: USER_ID,
      title: climb.trip.title,
      startedAt: new Date(`${climb.trip.startedAt}T00:00:00Z`).toISOString(),
      peakId,
      routeIds: [routeId],
      outcome: climb.trip.outcome,
      highpointM: result.stats.maxEleM,
      notes: climb.trip.notes,
      visibility: "public",
      createdAt: new Date().toISOString(),
    });

    tracks.push({
      id: id("track", i),
      tripId,
      // "drawn", not "gpx": this is an approximation from waypoints, and must
      // never be mistaken for a recorded track.
      source: "drawn",
      rawBlobUrl: `/demo/${file}`,
      line: result.line,
      bbox: result.bbox,
      stats: result.stats,
      profile: result.profile,
      privacyStartM: result.privacyStartM,
      startedAt: trips[trips.length - 1].startedAt,
      demSampled: result.demSampled,
    });

    console.log(
      `  → ${result.line.length} vertices · ${(result.stats.distanceM / 1000).toFixed(1)} km · ` +
        `+${result.stats.gainM}m / -${result.stats.lossM}m · high ${result.stats.maxEleM}m`,
    );
  }

  const snapshot = { users, peaks, routes, trips, tracks };
  await new LocalStore().replaceAll(snapshot);
  await writeFile(
    path.join(process.cwd(), "src", "lib", "store", "seed-data.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );

  console.log(`\nSeeded ${peaks.length} peaks, ${routes.length} routes, ${trips.length} trips.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
