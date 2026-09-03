# Implementation notes

What building Phases 0–2 changed about the plan in `docs/PLAN.md`. Every item
here was found by running the thing, not by reading docs — several contradict
what the docs say, and two contradict the plan itself.

---

## 1. The plan's Next.js config was wrong and hid a runtime failure

`docs/PLAN.md` did not specify it, but the obvious config —

```ts
transpilePackages: ["maplibre-gl"]
```

— **fails the Turbopack build outright**: MapLibre's ESM build constructs its
worker with `new Blob(['import "' + new URL(w, import.meta.url) + '"'])`, and
Turbopack cannot statically resolve that dynamic specifier.

The trap is that removing `transpilePackages` makes the build pass while
leaving the worker broken at runtime. The failure is completely silent:

- the map object exists with the correct camera,
- `getTerrain()` returns truthy,
- DEM tiles are fetched successfully (21 requests observed),
- no `error` event ever fires,
- and **nothing renders**, because raster-DEM decoding happens in that worker.

A network trace showed a worker created with the *page* URL as its script
(`/trips/<id>`), so the worker imported HTML, died instantly, and reported
nothing. Reproduced identically on Turbopack and webpack builds.

**Resolution:** pin `maplibre-gl` to v5 (see §2). v5 inlines its worker as a
blob and sidesteps bundler rewriting entirely.

## 2. maplibre-gl v6 is not usable with deck.gl 9.3 — pin to v5

`npm install maplibre-gl` resolves to 6.x, which breaks two ways:

1. The ESM module worker of §1.
2. `MapboxOverlay({ interleaved: true })` throws during `map.addControl`:
   `TypeError: Cannot read properties of undefined (reading 'elevation')`
   inside deck.gl's `_onAddInterleaved`. deck.gl 9.3 predates v6 and reads
   style internals whose shape changed.

**Resolution:** `maplibre-gl@^5.6`. The floor is 5.6.0 because that is where
the `color-relief` layer type landed, which the hypsometric skin depends on.

## 3. Interleaved rendering does not solve occlusion today — the plan was wrong

`PLAN.md` §2 gotcha #2 asserts that `interleaved: true` is what makes a ridge
correctly occlude the route, and that overlay mode is the broken option. That
is not what happens.

Measured on maplibre-gl 5.24 + deck.gl 9.3, with terrain enabled, by
pixel-sampling deck's own output for the route colour:

| Mode | deck layers created | Route pixels on screen |
| --- | --- | --- |
| `interleaved: true` | 3, all `visible` | **0** |
| `interleaved: false` | 3, all `visible` | ~3,800 |

Interleaved builds the layers and never gets them to screen: MapLibre draws the
terrain mesh in a pass a custom layer does not participate in, so the route is
painted and then buried. This is the same failure as the MapLibre issue our
research turned up (deck layer invisible with terrain on) — the commonly cited
fix, interleaving, does not actually resolve it.

**Resolution:** ship overlay mode. The route renders correctly, and the cost is
real and should be stated plainly: **there is no depth occlusion.** A section of
route behind a ridge draws on top of it rather than disappearing. Phase 2's
original ship gate — "the line correctly disappears behind the ridge as you
orbit" — is therefore **not met**, and is the top item for Phase 2.1.

Worth trying next: MapLibre's custom-layer terrain draping hooks
(`renderToTile` / `shouldRerenderTiles`), or drawing the route as a MapLibre
`line` layer draped on terrain for the occluded portion while keeping the deck
ribbon for the visible part.

## 4. A DEM tile proxy earns its place (not in the original plan)

`/api/dem/[z]/[x]/[y]` proxies the configured upstream. Added for three
reasons, only the first of which was foreseen:

1. **Cost.** Terrain tiles are immutable, so `s-maxage=2592000` turns repeat
   views into edge hits — the direct lever on the plan's top risk.
2. **Key hygiene.** Paid sources need a key in the tile URL; proxying keeps it
   server-side instead of shipping it in the client bundle.
3. **Egress.** Some networks block or throttle direct tile-host access from the
   browser while allowing the app's own origin. This is the difference between
   a working viewer and a blank one on such a network.

`getUpstreamTerrainSource()` exists so the proxy never resolves to itself, and
so server-side ingest talks to the real host directly.

## 5. Terrarium tiles carry bathymetry

A test asserting "sea level reads ≈ 0" failed: the mid-Atlantic returned
−3,417 m, which is correct — terrarium tiles are not clamped at zero. Anything
assuming a zero floor will be wrong at the coast, and the render clamp must
tolerate negative DEM values. Pinned in `live-probe.test.ts`.

## 6. The DEM-resolution risk, quantified

`PLAN.md` §8 flags that a ~30 m DEM makes alpine terrain mushy. Measured
against surveyed elevations at z12:

| Peak | Surveyed | DEM | Error | Shape |
| --- | --- | --- | --- | --- |
| Mt Rainier | 4,392 m | 4,379 m | −13 m | broad volcanic dome |
| Mont Blanc | 4,808 m | 4,775 m | −33 m | rounded snow dome |
| Matterhorn | 4,478 m | 4,254 m | **−224 m** | sharp rock pyramid |

The error tracks summit *shape*, not location or data quality: the sharper the
peak, the more of it falls below sampling resolution. Exactly the peaks
climbers care about are the ones the DEM represents worst. Set expectations in
the UI rather than treating it as a bug.

## 7. drizzle-kit cannot generate this schema's DDL

`drizzle-kit generate` produced migrations that cannot run:

1. No `CREATE EXTENSION postgis`, so every geography column fails first.
2. `customType` dataType strings are emitted as delimited identifiers —
   `"geography(Point,4326)"` — which Postgres reads as a type literally named
   that. Type modifiers are separate grammar from the type name.

**Resolution:** `drizzle/0000_init.sql` is hand-authored and is the source of
truth for DDL; `src/lib/db/schema.ts` remains the typed query surface. They are
kept in step by hand, which is a real maintenance cost worth knowing about
before the schema grows.

## 8. Two bugs the tests caught that review would not have

- **`maxGrade` always null.** The sliding window advanced its trailing edge
  until the span dropped *below* the threshold, so no window ever qualified.
  Found by asserting a value on a fixture with a known grade.
- **The route never drew.** The deck overlay is created inside
  `map.on("load")`, but the layer effect depended only on `[line,
  highlightIndex]` — so it ran once against a null overlay and never re-ran.
  Found by screenshotting the running app, not by any unit test.

The second is the more useful lesson: the geo library had 63 passing tests
while the actual product rendered nothing. Rendering needs its own verification.

---

## Status against the plan

| Phase | State |
| --- | --- |
| 0 — Skeleton | Done, minus Auth.js (needs OAuth credentials); a seeded demo user stands in. |
| 1 — Ingest + 2D | Done. Upload → parse → clean → DEM sample → stats → simplify → store, with the elevation profile rendering. |
| 2 — 3D viewer | Substantially done: terrain, hypsometric skin, route ribbon, auto-framed camera, profile scrub. **Ship gate not met** — no depth occlusion (§3). |
| 3–5 | Not started. |

Also not built: Postgres store (interface exists, `getStore()` throws rather
than silently writing production data to a JSON file), Blob client-upload
handshake (server path only, capped at 4.5 MB), MVT tiles, peak/route matching,
OSM import, social.
