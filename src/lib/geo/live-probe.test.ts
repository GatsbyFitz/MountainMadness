import { describe, expect, it } from "vitest";

import { fetchDemTile } from "./fetch-tile";
import { sampleElevations } from "./terrain";
import { getTerrainSource } from "@/lib/tiles/sources";

/**
 * Network test against the real AWS terrarium tiles.
 *
 * Opt in with LIVE_TERRAIN=1 so CI and offline work stay green. Its job is to
 * catch the one failure mode that is otherwise silent: a wrong encoding, which
 * yields plausible-looking numbers rather than an error. A mapbox decode of
 * terrarium bytes lands ~1,000,000 m out, so even loose bounds catch it.
 */
const live = process.env.LIVE_TERRAIN === "1" ? describe : describe.skip;

live("live terrain sampling (AWS terrarium)", () => {
  const summits = [
    // truth = surveyed summit elevation; tolerance reflects how much of the
    // peak's shape survives a ~30 m DEM, not the accuracy of the decoder.
    { name: "Mont Blanc", lat: 45.8326, lon: 6.8652, truth: 4808, tolerance: 120 },
    { name: "Mt Rainier", lat: 46.8523, lon: -121.7603, truth: 4392, tolerance: 120 },
    // A sharp rock spire: the DEM cannot hold the summit pyramid at all, and
    // under-reads by a couple of hundred metres. Documented, not a bug.
    { name: "Matterhorn", lat: 45.9763, lon: 7.6586, truth: 4478, tolerance: 400 },
  ];

  it("decodes real summits to within DEM resolution", async () => {
    const source = getTerrainSource("aws");
    const sampled = await sampleElevations(summits, source, (u) => fetchDemTile(u), 12);

    for (const [i, peak] of summits.entries()) {
      const z = sampled[i];
      expect(z, `${peak.name} returned no elevation`).not.toBeNull();
      expect(
        Math.abs(z! - peak.truth),
        `${peak.name}: DEM ${z?.toFixed(0)} m vs surveyed ${peak.truth} m`,
      ).toBeLessThan(peak.tolerance);
    }
  }, 60_000);

  it("carries bathymetry below sea level, not a zero floor", async () => {
    const source = getTerrainSource("aws");
    // Mid-Atlantic, far from any land. Terrarium tiles are not clamped at sea
    // level — they carry ocean depth, so this reads a few kilometres negative.
    // Worth pinning: anything that assumes "0 = sea level, nothing below" will
    // be wrong at the coast, and the render clamp must tolerate negative DEM.
    const [z] = await sampleElevations(
      [{ lat: 30.0, lon: -40.0 }],
      source,
      (u) => fetchDemTile(u),
      8,
    );
    expect(z).not.toBeNull();
    expect(z!).toBeLessThan(-1000);
    expect(z!).toBeGreaterThan(-7000);
  }, 60_000);
});
