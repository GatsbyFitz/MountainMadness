# MountainMadness — Technical Plan

A web app for logging mountain trips and routes worldwide, where every route is
rendered as a 3D line against the real 3D mountain it was climbed on.

Stack: **Next.js 16 (App Router) on Vercel + Neon Postgres/PostGIS + MapLibre GL JS
with deck.gl interleaved for the 3D viewer.**

---

## 1. Product shape

Three nouns, and everything hangs off them:

- **Peak** — a canonical mountain (Denali, Aiguille du Midi). Global registry, shared
  by all users, seeded from OpenStreetMap.
- **Route** — a canonical named line on a peak (Cassin Ridge, West Buttress). Shared,
  user-contributed, versioned. A route has an idealized geometry.
- **Trip** — *your* outing. Has a date, partners, conditions, notes, photos, an
  outcome, and usually a GPS track. A trip references zero or more routes.

The distinction between Route (shared, canonical) and Trip (personal, dated) is the
whole information architecture. Get it wrong and you end up with either a private
diary that has no discovery value, or a wiki with no personal log.

**Core loops**

1. *Log* — upload a GPX/FIT from your watch → we parse it, snap it to a peak, guess
   the route, compute stats → you confirm and annotate.
2. *Look* — open any trip or route and see it as a 3D line on the actual mountain.
   Orbit it, play the ascent back as a flyover, scrub the elevation profile.
3. *Explore* — a global map of peaks; per-peak pages listing every route and every
   public ascent; "who else has done this and when."

---

## 2. The hard part: rendering routes on mountains

This is the decision that constrains everything else, so it goes first.

### Recommendation

**MapLibre GL JS for the world (terrain mesh, camera, tiles, labels) + deck.gl
overlaid in `interleaved` mode for the route geometry.**

```
MapboxOverlay({ interleaved: true })   // deck.gl layers into MapLibre's WebGL2 context
  └── PathLayer      route ribbon at true altitude
  └── TripsLayer     animated flyover / progressive reveal
  └── ScatterplotLayer  waypoints, camps, photo pins
MapLibre
  └── raster-dem source + map.setTerrain()   // the mountain
  └── hillshade + hypsometric raster style   // the skin
```

**Why not pure react-three-fiber?** A hand-rolled three.js scene gives total control
and the prettiest possible flyover, but you'd be rebuilding tile loading, LOD,
frustum culling, mercator projection, and label placement — months of work that
MapLibre already does. Keep r3f in your pocket for a future "cinematic export" mode
that renders one pre-fetched, high-detail tile set.

**Why not Cesium?** Genuinely excellent globe-scale terrain, but a heavy bundle, its
own data ecosystem, and quantized-mesh terrain that mostly means paying Cesium ion.
Overkill for peak-scale scenes.

**Why not just MapLibre alone?** MapLibre drapes `line` layers *onto* the terrain
surface. That's correct for a hiking trail, and wrong for everything interesting: a
ski descent, a couloir, an aerial ridge traverse. You need lines that live at a real
z. That's deck.gl's `PathLayer` with 3D positions.

### Three gotchas that will eat a day each if you don't know them up front

1. **Encoding.** Terrain-RGB comes in `mapbox` and `terrarium` flavors with different
   decoders. Free/open sources are almost all terrarium. Declaring the wrong one
   fails *silently* — you get a plausible-looking but wrong mountain. Set
   `encoding: 'terrarium'` explicitly and validate against a known summit elevation
   in a test.
2. **deck.gl layers vanish when terrain is enabled** unless the overlay is
   `interleaved: true` (requires WebGL2 and maplibre-gl v3+). In non-interleaved
   overlay mode deck draws into a separate canvas on top and the depth buffers never
   meet, so terrain either fully occludes or never occludes your route. Interleaved
   is the only mode that gives you a route line correctly disappearing behind a ridge.
3. **A true-altitude track will clip through a 30m DEM.** On a 45° face, ~30m of
   horizontal DEM error is ~30m of vertical error, so the GPS track sinks into the
   mesh and half your route is invisible. **Fix:** sample the DEM along the track at
   ingest time, store `dem_z` alongside `gps_z`, and render at
   `max(gps_z, dem_z + clearance)` with `clearance ≈ 15m`. Store both so you can
   still chart honest GPS elevation in the profile.

### Making it read as 3D

- Route as a **screen-space-constant ribbon** (`PathLayer`, `billboard: true`,
  4–6px) — a world-width line becomes invisible when you zoom out to see the whole
  face.
- Plus a **drop shadow line** draped on the terrain directly beneath the route
  (`PathLayer` with `TerrainExtension`, dark, 50% opacity). This is the classic
  topo-illustration trick and it's what actually sells the depth — without it the
  ribbon floats in undefined space.
- **Default skin is hillshade + hypsometric tint, not satellite.** Shaded relief is
  free, needs no API key, works at every zoom, and — importantly — a colored route
  line reads far better against neutral grey rock than against a photographic
  texture. Satellite is a toggle for users who want it.
- **Auto-framed camera.** On load, compute the track bbox, derive the dominant aspect
  from the terrain normals along the route, and place the camera on that side at
  `pitch ≈ 65°` — so you look *at* the face, not at the back of the mountain. Then
  a slow idle orbit. Framing is what makes the viewer feel authored rather than
  dumped.

### Performance budget

| Thing | Budget |
| --- | --- |
| Route points sent to client | ≤ 3,000 (simplify server-side) |
| Terrain tiles in flight | MapLibre default, `maxzoom: 14` on the DEM source |
| Time to first painted mountain | < 1.5s on desktop broadband |
| Frame rate | 60fps desktop, 30fps mid-range mobile |
| Viewer JS (lazy chunk) | < 400KB gzipped |

---

## 3. Data sources

| Need | Choice | Notes |
| --- | --- | --- |
| Terrain DEM (dev) | AWS Open Data terrarium tiles | Free, no key, global. Fine for building. |
| Terrain DEM (prod) | Self-hosted **Mapterhorn** terrarium PMTiles on Cloudflare R2 | Free data, no per-tile vendor cost, CDN in front. R2 for guaranteed HTTP range-request support and zero egress. |
| Terrain DEM (fallback) | MapTiler / Mapbox terrain-RGB | Paid, SLA'd, higher zoom. Keep the source swappable behind one config object. |
| Basemap style | Self-hosted vector tiles (Protomaps basemap) or MapTiler | Same swap-ability rule. |
| Satellite (optional toggle) | MapTiler or Mapbox satellite | Metered — put it behind a user toggle, not the default. |
| Peaks registry | OpenStreetMap `natural=peak` via Overpass, imported offline | Do a one-time bulk import into our own `peaks` table. **Do not** call Overpass at request time. |
| Elevation enrichment | Sample our own DEM tiles server-side | Public OpenTopoData is capped at 1 req/s and 1000/day — usable for a spike, not for production ingest. |

**Design rule:** every tile source lives behind `lib/tiles/sources.ts` exporting a
single `TerrainSource` object (`url`, `encoding`, `tileSize`, `maxzoom`,
`attribution`). Swapping vendors must be a one-file change, because you *will* swap
vendors when the bill arrives.

---

## 4. Data model (Postgres + PostGIS on Neon)

Use **Neon directly**, not the Vercel Postgres product surface — extension support is
restricted there, and PostGIS is non-negotiable here. Neon's Vercel integration still
gives you a database branch per preview deployment, which is the actually valuable
part.

```sql
-- ---------- canonical, shared ----------
peaks (
  id            uuid pk,
  slug          text unique,            -- 'denali', 'aiguille-du-midi'
  name          text,
  alt_names     text[],
  location      geography(Point,4326),  -- GIST index
  elevation_m   int,
  prominence_m  int,
  country_code  text,
  range_name    text,
  osm_id        bigint unique,
  created_at    timestamptz
)

routes (
  id            uuid pk,
  peak_id       uuid -> peaks,
  slug          text,                   -- unique per peak
  name          text,                   -- 'Cassin Ridge'
  discipline    text,                   -- hike|scramble|alpine|rock|ice|ski|mixed
  grade_system  text,                   -- yds|uiaa|french|ueaa|alaska|scottish|...
  grade         text,
  vertical_m    int,
  aspect_deg    smallint,
  season        int4range,              -- typical months
  description   text,
  geom          geography(LineStringZ,4326),  -- idealized line, nullable
  created_by    uuid -> users,
  created_at, updated_at
)
route_revisions (...)                   -- wiki-style edit history, append only

-- ---------- personal ----------
users (id, handle unique, display_name, avatar_url, home_country, created_at)

trips (
  id            uuid pk,
  user_id       uuid -> users,
  title         text,
  started_at    timestamptz,
  ended_at      timestamptz,
  peak_id       uuid -> peaks null,
  outcome       text,                   -- summit|highpoint|retreat|recon
  highpoint_m   int,
  conditions    jsonb,                  -- snow, temp, partners, gear
  notes         text,
  visibility    text,                   -- public|followers|private
  created_at, updated_at
)
trip_routes (trip_id, route_id, sequence, outcome)   -- a trip may link >1 route

tracks (
  id            uuid pk,
  trip_id       uuid -> trips,
  source        text,                   -- gpx|fit|tcx|drawn
  raw_blob_url  text,                   -- original file in Vercel Blob
  geom          geography(LineStringZ,4326),   -- full-res, GIST index
  geom_simple   geography(LineStringZ,4326),   -- ~3k pts, what the viewer loads
  bbox          geography(Polygon,4326),
  distance_m    int,
  gain_m        int,
  loss_m        int,
  duration_s    int,
  moving_s      int,
  started_at    timestamptz,
  profile       jsonb,   -- [{d, gps_z, dem_z, t, hr?}] resampled to ~500 pts
  privacy_start_m int default 0         -- metres trimmed from each end
)

media (
  id, trip_id, blob_url, width, height, taken_at,
  location geography(Point,4326) null,
  track_offset_m int null,              -- position along the track, for the flyover
  caption
)

-- ---------- social ----------
follows (follower_id, followee_id, created_at)
trip_reactions (trip_id, user_id, kind)
comments (id, trip_id, user_id, body, created_at)
```

**Notes on the shape**

- `geom` full-res stays in Postgres (compressed, and needed for spatial joins);
  the original uploaded file stays in Blob as the immutable source of truth so you
  can always re-derive after a parser fix.
- `geom_simple` is precomputed once at ingest with `ST_SimplifyPreserveTopology`
  targeting ~3k points. Never simplify per request.
- `profile` as JSONB avoids a million-row `track_points` table. If you later want
  per-point HR/cadence analytics, add a columnar side table then — not now.
- `privacy_start_m` is a **launch requirement, not a nice-to-have**: mountain tracks
  routinely start in a trailhead parking lot, and sometimes at someone's house. Trim
  both ends of `geom_simple` before it ever leaves the server; never rely on the
  client to hide it.

**Indexes:** GIST on every geography column, `btree` on `trips(user_id, started_at
desc)`, `trips(peak_id)` filtered to `visibility='public'`, `peaks(slug)`,
`routes(peak_id, slug)`.

---

## 5. Architecture on Vercel

```
app/
  (marketing)/page.tsx              landing, static
  explore/page.tsx                  global peak map (MVT-driven)
  peaks/[slug]/page.tsx             peak page — ISR, revalidate 3600
  peaks/[slug]/routes/[route]/page.tsx
  trips/[id]/page.tsx               trip page (RSC shell)
  trips/new/page.tsx                upload + confirm flow
  u/[handle]/page.tsx               profile, stats, personal map
  api/
    tiles/peaks/[z]/[x]/[y]/route.ts    ST_AsMVT, s-maxage=86400
    tiles/tracks/[z]/[x]/[y]/route.ts   public tracks as MVT (the global heatmap)
    upload/route.ts                     Blob client-upload token handshake
    ingest/route.ts                     onUploadCompleted webhook → parse
    og/trip/[id]/route.tsx              OG image (ImageResponse)
components/
  viewer/                           ALL client-only, lazily imported
    MountainViewer.tsx              dynamic(() => ..., { ssr: false })
    useTerrainSource.ts
    RouteRibbon.tsx / Flyover.tsx / ElevationProfile.tsx
lib/
  db/            drizzle schema + typed queries
  geo/           gpx/fit parsers, simplification, stats, DEM sampling
  tiles/sources.ts
```

**Rendering strategy**

- Peak and route pages are RSC + ISR — mostly static content, great for SEO, and
  peak pages are the discovery surface.
- Trip pages are RSC for chrome/metadata; the viewer is one lazily-imported client
  island. MapLibre and three both touch `window`, so `ssr: false` is mandatory —
  and it keeps ~400KB of WebGL out of every other page's bundle.
- Track geometry is fetched by the client island from a cached route handler, not
  serialized into the RSC payload — it's large and independently cacheable.

**The upload path (this is where Vercel bites)**

Vercel functions have a hard **4.5MB request/response body limit** — and a
multi-day FIT file or a dense GPX blows past it. So:

```
browser --(handshake)--> /api/upload         issues a client token
browser --(direct PUT)--> Vercel Blob        up to 5TB, never touches our function
Blob    --(webhook)-----> /api/ingest        parse, sample DEM, compute stats, insert
browser <--(poll/SSE)---- trips/[id]         "processing" → "ready"
```

Use `@vercel/blob` **client uploads**, not server uploads. The ingest function needs
`maxDuration` raised (300s on Pro) — a season-long FIT with a DEM sample per point is
not a 10-second job. If ingest ever exceeds that, move it to a queue and keep the
webhook as a thin enqueuer.

**Caching**

- MVT tile handlers: `Cache-Control: public, s-maxage=86400,
  stale-while-revalidate=604800`. Peaks change ~never.
- Track geometry: immutable per `updated_at`-stamped URL.
- Peak pages: ISR with on-demand `revalidatePath` when a new public trip lands.

**Auth:** Auth.js v5 with OAuth (Google, Apple) + email magic link. No passwords.
Session in a JWT cookie, user row in Neon.

**Runtime:** Node runtime for anything using PostGIS-heavy queries and the parsers.
Neon's HTTP driver works on Edge, but the geometry work doesn't buy anything from
Edge here — pick Node and stop thinking about it.

---

## 6. Ingest pipeline

```
raw file (Blob)
  → parse            gpx | fit | tcx  →  [{lat, lon, ele, t, hr?}]
  → clean            drop null-island, dedupe, despike elevation (median-of-5),
                     detect and drop pauses
  → DEM sample       for each point, bilinear-sample the terrain tile → dem_z
  → stats            distance (haversine), gain/loss on the *smoothed* series,
                     moving time, max slope
  → simplify         ST_SimplifyPreserveTopology → geom_simple (~3k pts)
  → profile          resample to 500 evenly-spaced points → JSONB
  → match            nearest peaks within 5km of the track's highpoint (ST_DWithin);
                     nearest routes by Fréchet/Hausdorff distance to route.geom
  → persist          tracks row + candidate peak/route suggestions
  → confirm          user picks from the suggestions in the UI
```

Two things worth calling out:

- **Gain must be computed on smoothed elevation.** Raw GPS/barometric noise inflates
  cumulative gain by 20–40%. Every logging app that gets this wrong gets bug reports
  forever. Median-filter, then threshold (ignore deltas < 3m).
- **Route matching is a suggestion, never an assignment.** Show the top 3 candidates
  with confidence and let the user pick or create a new route. Auto-assignment
  silently pollutes the shared route registry, which is your most valuable asset.

---

## 7. Build phases

Each phase ends deployed and usable.

**Phase 0 — Skeleton (week 1).** Next 16 + TS + Tailwind, Drizzle + Neon with
PostGIS enabled, Auth.js, Vercel project with preview DB branching, CI running
typecheck/lint/test.

**Phase 1 — Ingest and 2D proof (weeks 2–3).** Blob client upload → ingest webhook →
GPX parse → stats → trip page with a *2D* MapLibre map and an elevation profile.
No 3D yet. This de-risks the whole data pipeline before any WebGL exists.
*Ship gate: upload a real GPX from a real trip and see correct distance and gain.*

**Phase 2 — The 3D viewer (weeks 4–6).** The actual product. Terrain source,
interleaved deck.gl, route ribbon + drop shadow, DEM-clamped altitude, auto-framed
camera, orbit controls, profile ↔ 3D scrub linking.
*Ship gate: a knife-edge ridge route where the line correctly disappears behind the
ridge as you orbit.*

**Phase 3 — Peaks and routes (weeks 7–8).** OSM peak import (~1M `natural=peak`
nodes worldwide; filter to prominence/elevation thresholds first), peak pages, route
CRUD with revision history, peak/route matching in the confirm flow.

**Phase 4 — Explore and social (weeks 9–10).** MVT-backed global map, follows, public
trip feed, per-user stats (vertical this year, peaks bagged, countries), OG images
for sharing.

**Phase 5 — Flyover and polish (weeks 11–12).** TripsLayer animated ascent playback
with photo pins firing at their track offset, mobile perf pass, video/GIF export of
the flyover.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| **Tile costs scale with engagement** — a 3D viewer pulls far more tiles than a 2D map, and metered vendors bill per request. | Self-host terrain PMTiles from R2 from day one. Keep the source swappable. Instrument tile counts per session before launch, not after the invoice. |
| **30m DEM makes alpine terrain mushy.** Aretes, gendarmes and couloirs — exactly what climbers care about — are below the sampling resolution. | Accept it globally; layer higher-res regional DEMs (USGS 3DEP 10m/1m, Swisstopo, IGN) for popular ranges behind the same `TerrainSource` interface. Set expectations in the UI at high zoom. |
| **Mobile WebGL memory.** Terrain + satellite + deck layers OOM cheap Android devices. | Cap DEM `maxzoom` and disable satellite by default on mobile; feature-detect and offer a 2D fallback rather than a crashed canvas. |
| **Location privacy.** Tracks reveal homes and, for some users, sensitive routines. | Server-side privacy trimming (§4), private-by-default for new users, per-trip visibility, and never emit untrimmed geometry to any client or MVT tile. |
| **Empty shared registry.** Routes and peaks are worthless until populated, and that's a cold-start problem. | Seed peaks from OSM (automatic). Seed the first few hundred routes manually for 10–15 flagship ranges. Make "create route from my track" a one-click path in the confirm flow. |
| **Scope creep into a training app.** HR zones, TSS, gear lockers, weather forecasting — all adjacent, all endless. | The product is the 3D route record. Anything that doesn't make a route look better or get logged faster is post-v1. |

---

## 9. Open questions for the product owner

1. **Public by default or private by default?** Drives the social architecture, and
   it's very hard to change later. (Recommendation: private by default, with a
   prominent share action — the mountaineering audience skews privacy-conscious.)
2. **Is the shared route registry editable by anyone (wiki) or by the creator only?**
   Wiki gets better data and needs moderation tooling; creator-only needs neither and
   fragments into duplicates.
3. **Strava import?** It's how most people already have their tracks, and it would
   remove the biggest onboarding hurdle — but it's a full OAuth integration plus rate
   limits, so it's a Phase 4+ decision, not a v1 one.

---

## Sources

- [deck.gl TerrainLayer](https://deck.gl/docs/api-reference/geo-layers/terrain-layer) · [TerrainExtension](https://deck.gl/docs/api-reference/extensions/terrain-extension) · [Using deck.gl with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre)
- [MapLibre GL JS 3D Terrain](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/) · [deck.gl layer not visible with terrain](https://github.com/maplibre/maplibre-gl-js/discussions/2245)
- [Mapterhorn — terrain for web mapping](https://protomaps.com/blog/mapterhorn-terrain/) · [AWS Terrain Tiles open data](https://registry.opendata.aws/terrain-tiles/)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations) · [Client uploads with Vercel Blob](https://vercel.com/docs/vercel-blob/client-upload)
- [Neon: Vercel Postgres transition guide](https://neon.com/docs/guides/vercel-postgres-transition-guide)
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Open Topo Data API limits](https://www.opentopodata.org/api/)
