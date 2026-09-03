# MountainMadness

Log mountain trips and see your routes drawn on the real mountain, in 3D.

![The Goûter route on Mont Blanc](docs/screenshot-viewer.png)

Next.js 16 · MapLibre GL JS terrain · deck.gl · PostGIS-ready

---

## Run it

No cloud credentials, no API keys, no database:

```bash
npm install
npx tsx scripts/seed.ts   # builds a demo track from real terrain (needs network)
npm run dev               # http://localhost:3000
```

The seed walks the real Goûter route waypoints on Mont Blanc, samples the actual
DEM for elevation, and runs the result through the same ingest pipeline an
upload uses. Then open the trip and orbit the mountain.

Uploading your own GPX at `/trips/new` works the same way.

## What it does

- **Ingest** — GPX in, cleaned and analysed out: null-island and GPS-teleport
  rejection, median-filtered elevation, hysteresis-banded ascent, moving time,
  windowed max grade, Douglas–Peucker simplification to a fixed point budget,
  and a distance-even elevation profile.
- **Terrain sampling** — the DEM is sampled along the track at ingest, so the
  drawn route can be lifted clear of a coarse mesh instead of sinking into it.
- **3D viewer** — MapLibre terrain with four skins (DEM-generated relief,
  satellite, topo, map), a screen-width route ribbon with a draped drop shadow,
  and a camera that frames the route from its low end so you look *at* the face.
  Imagery is proxied through `/api/raster` so it is edge-cached and carries no
  vendor key in the client bundle.
- **Waypoint snapping** — approximate coordinates are corrected against the DEM
  (summits to the local maximum, huts to their published elevation) and dropped
  entirely when they cannot be verified, rather than inventing terrain.
- **Privacy trimming** — applied server-side at ingest, before geometry is
  stored, so a trimmed section never reaches any client.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests (89) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Rebuild peaks/routes/trips from `scripts/climbs.ts` |
| `npm run db:migrate` | Apply `drizzle/0000_init.sql` to Neon |
| `npm run db:seed` | Load the seed snapshot into Neon |
| `npm run db:status` | What is actually in the database |
| `LIVE_TERRAIN=1 npm test` | Also run the network tests against real DEM tiles |

## Configuration

Everything is optional; defaults run locally with no setup. See `.env.example`.

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_TERRAIN_SOURCE` | `proxy` (default), `aws`, `maptiler`, `custom` |
| `TERRAIN_UPSTREAM` | What `/api/dem` fetches from. Defaults to `aws`. |
| `DATABASE_URL` | Selects the Postgres/PostGIS store. Unset uses the local JSON store. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob. Unset stores uploads under `.data/blob/` |

Terrain sources live in one file, `src/lib/tiles/sources.ts`. Swapping vendors
is a one-file change, by design — tile costs scale with engagement and you will
want to move.

## Layout

```
src/lib/geo/       parsing, cleaning, stats, simplification, DEM sampling
src/lib/store/     storage seam: Store interface + local JSON implementation
src/lib/tiles/     terrain source registry — the only place tile hosts appear
src/components/viewer/   the 3D viewer (client-only, lazily imported)
src/app/api/dem/   DEM tile proxy: edge-cacheable, keeps vendor keys server-side
drizzle/           hand-authored PostGIS DDL
docs/PLAN.md       the architecture plan this was built from
docs/IMPLEMENTATION-NOTES.md   where building it proved the plan wrong
docs/DEPLOYMENT.md Vercel settings and ordered next steps
```

## Deploying

Import the repo into Vercel and deploy — no environment variables required.
You get a working read-only demo (the 3D viewer, terrain, the Mont Blanc
route, edge-cached tiles), because the demo data ships in the bundle.

**Uploads return `503` until a database is wired up**, because Vercel's
filesystem is read-only. `docs/DEPLOYMENT.md` covers the settings that matter
and the ordered next steps to make it writable.

## Known limitations

Read `docs/IMPLEMENTATION-NOTES.md` for the evidence behind each of these.

- **No depth occlusion.** Route sections behind a ridge draw on top of it
  instead of disappearing. deck.gl's interleaved mode — the usual fix — creates
  the layers but never gets them to screen while MapLibre terrain is on
  (measured: 0 route pixels interleaved vs ~3,800 in overlay mode). This is
  Phase 2's ship gate and it is not met.
- **`maplibre-gl` is pinned to v5.** v6 breaks both its bundled worker and
  deck.gl 9.3's interleaved mode.
- **Seeded routes are approximations.** The five climbs come from the Notion
  diaries, but their geometry is drawn from named waypoints (trailheads, huts,
  cols, summits), not recorded GPS. They are stored as `source: "drawn"` and
  labelled as such in the viewer. Uploading the Strava GPX for a trip replaces
  the approximation with the real track.
- **No auth.** Every upload is attributed to one seeded demo user.
- **Uploads capped at 4.5 MB**, the Vercel function body limit. The Blob
  client-upload handshake that lifts this is designed but not built.
- **A ~30 m DEM under-reads sharp summits** by up to ~200 m (Matterhorn:
  4,254 m vs 4,478 m surveyed). Inherent to the data, not a bug.
