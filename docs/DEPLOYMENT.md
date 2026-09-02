# Deploying to Vercel

## What you get from a deploy today

Import the repo into Vercel and deploy. No environment variables are required.
You will get a working, **read-only** demo:

- The Mont Blanc trip page, with the 3D viewer, terrain, route ribbon,
  auto-framed camera and the linked elevation profile.
- The peak page and trip list.
- `/api/dem` serving edge-cached terrain tiles.

Demo data ships in the bundle (`src/lib/store/seed-data.json`), so a fresh
deploy is not an empty shell.

**Uploads will not work.** `/trips/new` returns `503` with an explanation.
That is deliberate — see below.

## Why uploads don't work yet

Vercel Functions run on a [read-only filesystem][fs] with only a
per-invocation `/tmp` (500 MB, not shared between invocations). The current
storage layer is a JSON file plus local blob directory, which is fine for
`npm run dev` and impossible in production.

Both write paths detect this and raise `ReadOnlyStoreError`, which the upload
route turns into a `503` with an actionable message. The alternative —
returning `200` for a write that went nowhere — would tell a user their trip
was saved and then lose it, so the failure is deliberately loud.

[fs]: https://vercel.com/docs/functions/runtimes

## Settings that matter

| Setting | Value | Why |
| --- | --- | --- |
| Framework preset | Next.js | Auto-detected. |
| Build command | default (`next build`) | Turbopack. Do **not** add `transpilePackages: ["maplibre-gl"]` — it fails the build, and removing it after the fact leaves a silently broken worker (`docs/IMPLEMENTATION-NOTES.md` §1). |
| Node version | 22.x | Matches local. |
| `maxDuration` on `/api/upload` | 60 | Hobby's ceiling. Pro allows up to 800 s; raise it when ingest starts timing out on long traverses. |

Optional environment variables (all have working defaults):

```
NEXT_PUBLIC_TERRAIN_SOURCE=proxy    # default; routes tiles via /api/dem
TERRAIN_UPSTREAM=aws                # what /api/dem fetches from
```

### Watch the tile bill

`/api/dem` sets `s-maxage=2592000, immutable`, so repeat views hit Vercel's
edge cache rather than the upstream. Tiles do still count toward **Vercel
bandwidth and function invocations** on a cache miss.

Check `Fast Data Transfer` and function invocation counts after the first
week of real use. If they climb, the next move is the one the plan already
called for: self-host Mapterhorn terrarium PMTiles on Cloudflare R2 (zero
egress) and point `NEXT_PUBLIC_TERRAIN_TILE_URL` at it with
`NEXT_PUBLIC_TERRAIN_SOURCE=custom`. That is a one-file change by design.

---

# Next steps, in order

## 1. Make it writable — Neon Postgres (the only thing blocking real use)

Nothing else matters until uploads persist. Everything is staged for this:
the schema, the DDL, and a `Store` interface with one method group per
concern.

1. Create a Neon project. Use **Neon directly**, not the Vercel Postgres
   surface — extension support is restricted there and PostGIS is required.
2. Add the Neon integration to the Vercel project so preview deployments get
   their own database branch.
3. Run `drizzle/0000_init.sql`. It is hand-authored and includes
   `CREATE EXTENSION postgis`; `drizzle-kit generate` cannot produce working
   DDL for this schema (`IMPLEMENTATION-NOTES.md` §7).
4. Implement `PostgresStore` against `src/lib/store/types.ts` and return it
   from `getStore()` when `DATABASE_URL` is set. `getStore()` currently
   throws in that case rather than silently writing production data to an
   ephemeral filesystem, so this is the switch that turns it on.
5. Set `BLOB_READ_WRITE_TOKEN` so raw uploads go to Vercel Blob instead of
   the local directory. `putBlob` already branches on it.

Geometry conversion is the only fiddly part: `Track.line` is
`[lon, lat, z][]` and the column is `geography(LineStringZ,4326)`. Write via
`ST_GeomFromText('LINESTRING Z (...)', 4326)` and read via `ST_AsText`.

**Estimate:** 1–2 days. **Unblocks:** everything.

## 2. Add auth

Every upload is currently attributed to one seeded demo user
(`src/lib/demo.ts`). Auth.js v5 with Google/Apple OAuth plus email magic
link, per the plan. Replacing `DEMO_USER_ID` with the session lookup in
`/api/upload` is the only change the ingest path needs.

**Estimate:** half a day, most of it OAuth app registration.

## 3. Lift the 4.5 MB upload cap

The server-upload path is capped by Vercel's [4.5 MB function body limit][body],
which a multi-day FIT file exceeds. The fix is designed but not built: use
`@vercel/blob` **client uploads** so the browser PUTs straight to Blob, then
drive ingest from the `onUploadCompleted` webhook. `src/lib/store/blob.ts`
documents the flow.

Do this together with step 1 — the webhook needs somewhere to write.

[body]: https://vercel.com/docs/functions/limitations

**Estimate:** half a day.

## 4. Fix depth occlusion (Phase 2's unmet ship gate)

Route sections behind a ridge currently draw on top of it. This is the one
place the product visibly falls short of the plan, and it is worth fixing
before showing it to climbers, who will notice immediately.

Measured evidence and the two approaches worth trying are in
`IMPLEMENTATION-NOTES.md` §3. Short version: deck.gl's `interleaved` mode
creates the layers and never gets them to screen while MapLibre terrain is
on, so the fix is either MapLibre's custom-layer terrain-draping hooks
(`renderToTile` / `shouldRerenderTiles`) or a hybrid — a draped MapLibre
`line` layer for the occluded portion plus the deck ribbon for the visible
part.

**Estimate:** 1–3 days, genuinely uncertain — this is research, not
plumbing.

## 5. Then the plan's Phase 3 onward

Peaks and routes registry (OSM import, route CRUD, peak matching in the
confirm flow), then explore/social, then flyover. `docs/PLAN.md` §7 has the
sequencing and ship gates.

---

## Recommended order

If the goal is *a thing climbers can actually use*: **1 → 2 → 3 → 4**. The
first three are well-understood work that turns a demo into an app; the
fourth is the quality bar that makes it worth showing.

If the goal is *a compelling demo to show people*: **4 → 1**. The occlusion
gap is what a mountaineer will notice in the first ten seconds; persistence
is what they will notice in the first ten minutes.
