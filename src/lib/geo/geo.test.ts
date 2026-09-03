import { describe, expect, it } from "vitest";

import { cleanPoints, fillElevation, medianFilter } from "./clean";
import { GpxParseError, parseGpx, parseGpxName } from "./gpx";
import { haversine } from "./measure";
import { ingestGpx } from "./pipeline";
import { buildProfile, trimForPrivacy } from "./profile";
import { douglasPeuckerIndices, simplifyToTarget } from "./simplify";
import { computeStats, cumulativeDistances, gainLoss } from "./stats";
import {
  bilinearSample,
  decodeElevation,
  lonLatToTile,
  renderHeight,
  sampleElevations,
  type DemTile,
  type TerrainSourceConfig,
} from "./terrain";
import type { RawPoint, TrackPoint } from "./types";

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function gpxOf(
  pts: { lat: number; lon: number; ele?: number; time?: string }[],
  name = "Test Track",
): string {
  const body = pts
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}">` +
        (p.ele !== undefined ? `<ele>${p.ele}</ele>` : "") +
        (p.time ? `<time>${p.time}</time>` : "") +
        `</trkpt>`,
    )
    .join("\n");
  return `<?xml version="1.0"?>
<gpx version="1.1" creator="test"><trk><name>${name}</name><trkseg>
${body}
</trkseg></trk></gpx>`;
}

/** Builds a synthetic terrarium tile where every pixel encodes `elevation`. */
function flatTile(elevation: number, size = 8): DemTile {
  const v = elevation + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width: size, height: size, data };
}

// --------------------------------------------------------------------------
// GPX parsing
// --------------------------------------------------------------------------

describe("parseGpx", () => {
  it("reads coordinates, elevation and time", () => {
    const pts = parseGpx(
      gpxOf([
        { lat: 46.5, lon: 8.0, ele: 1200, time: "2025-07-14T06:00:00Z" },
        { lat: 46.51, lon: 8.01, ele: 1400, time: "2025-07-14T07:00:00Z" },
      ]),
    );
    expect(pts).toHaveLength(2);
    expect(pts[0].lat).toBeCloseTo(46.5);
    expect(pts[0].ele).toBe(1200);
    expect(pts[1].t).toBe(Date.parse("2025-07-14T07:00:00Z"));
  });

  it("handles self-closing trkpt elements", () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="46.5" lon="8.0"/>
      <trkpt lat="46.6" lon="8.1"/>
    </trkseg></trk></gpx>`;
    const pts = parseGpx(xml);
    expect(pts).toHaveLength(2);
    expect(pts[0].ele).toBeNull();
  });

  it("reads single-quoted attributes", () => {
    const pts = parseGpx(`<gpx><trkpt lat='1.5' lon='2.5'></trkpt></gpx>`);
    expect(pts[0].lat).toBe(1.5);
    expect(pts[0].lon).toBe(2.5);
  });

  it("flattens multiple segments in document order", () => {
    const xml = `<gpx><trk>
      <trkseg><trkpt lat="1" lon="1"></trkpt></trkseg>
      <trkseg><trkpt lat="2" lon="2"></trkpt></trkseg>
    </trk></gpx>`;
    expect(parseGpx(xml).map((p) => p.lat)).toEqual([1, 2]);
  });

  it("rejects a non-GPX document", () => {
    expect(() => parseGpx("<html><body>nope</body></html>")).toThrow(GpxParseError);
  });

  it("rejects a GPX with no track points", () => {
    expect(() => parseGpx("<gpx><trk></trk></gpx>")).toThrow(GpxParseError);
  });

  it("skips points missing coordinates rather than failing the file", () => {
    const xml = `<gpx>
      <trkpt lon="8.0"></trkpt>
      <trkpt lat="46.5" lon="8.0"></trkpt>
    </gpx>`;
    expect(parseGpx(xml)).toHaveLength(1);
  });

  it("reads the track name", () => {
    expect(parseGpxName(gpxOf([{ lat: 1, lon: 1 }], "Cassin Ridge"))).toBe("Cassin Ridge");
  });
});

// --------------------------------------------------------------------------
// distance
// --------------------------------------------------------------------------

describe("haversine", () => {
  it("matches a known long-distance pair", () => {
    // Paris CDG to Los Angeles LAX, ~9124 km.
    const d = haversine(49.0097, 2.5479, 33.9425, -118.408);
    expect(d / 1000).toBeGreaterThan(9080);
    expect(d / 1000).toBeLessThan(9160);
  });

  it("is zero for identical points", () => {
    expect(haversine(46.5, 8.0, 46.5, 8.0)).toBe(0);
  });

  it("gives ~111 km per degree of latitude", () => {
    const d = haversine(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

// --------------------------------------------------------------------------
// cleaning
// --------------------------------------------------------------------------

describe("medianFilter", () => {
  it("removes a single-sample spike", () => {
    const out = medianFilter([100, 100, 900, 100, 100], 5);
    expect(out[2]).toBe(100);
  });

  it("preserves a genuine step", () => {
    const out = medianFilter([100, 100, 100, 200, 200, 200], 3);
    expect(out[0]).toBe(100);
    expect(out[5]).toBe(200);
  });
});

describe("fillElevation", () => {
  it("interpolates interior gaps", () => {
    const pts: RawPoint[] = [
      { lat: 0, lon: 0, ele: 100, t: null },
      { lat: 0, lon: 0, ele: null, t: null },
      { lat: 0, lon: 0, ele: 300, t: null },
    ];
    expect(fillElevation(pts)).toEqual([100, 200, 300]);
  });

  it("extends flat at both ends", () => {
    const pts: RawPoint[] = [
      { lat: 0, lon: 0, ele: null, t: null },
      { lat: 0, lon: 0, ele: 500, t: null },
      { lat: 0, lon: 0, ele: null, t: null },
    ];
    expect(fillElevation(pts)).toEqual([500, 500, 500]);
  });

  it("returns null when no elevation is known at all", () => {
    const pts: RawPoint[] = [{ lat: 0, lon: 0, ele: null, t: null }];
    expect(fillElevation(pts)).toBeNull();
  });
});

describe("cleanPoints", () => {
  it("drops the null-island sentinel", () => {
    const { points, dropped } = cleanPoints([
      { lat: 0, lon: 0, ele: 0, t: null },
      { lat: 46.5, lon: 8.0, ele: 1200, t: null },
    ]);
    expect(points).toHaveLength(1);
    expect(dropped.implausible).toBe(1);
  });

  it("drops GPS teleports", () => {
    const { dropped } = cleanPoints([
      { lat: 46.5, lon: 8.0, ele: 1200, t: 0 },
      // 1 degree of latitude away one second later.
      { lat: 47.5, lon: 8.0, ele: 1200, t: 1000 },
      { lat: 46.5001, lon: 8.0, ele: 1200, t: 2000 },
    ]);
    expect(dropped.teleport).toBe(1);
  });

  it("keeps stationary samples that carry new timestamps", () => {
    // A rest stop must still contribute to elapsed duration.
    const { points } = cleanPoints([
      { lat: 46.5, lon: 8.0, ele: 1200, t: 0 },
      { lat: 46.5, lon: 8.0, ele: 1200, t: 60_000 },
    ]);
    expect(points).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------
// gain — the number every logging app gets wrong
// --------------------------------------------------------------------------

describe("gainLoss", () => {
  it("ignores noise on a flat traverse", () => {
    // +/-1 m jitter around 2000 m, 200 samples: a naive sum reports ~200 m.
    const flat = Array.from({ length: 200 }, (_, i) => 2000 + (i % 2 === 0 ? 1 : -1));
    const { gain } = gainLoss(flat, 3);
    expect(gain).toBe(0);
  });

  it("banks a staircase climb made of sub-threshold steps", () => {
    // 1 m per sample for 100 samples. Per-delta thresholding would report 0.
    const stair = Array.from({ length: 101 }, (_, i) => 1000 + i);
    const { gain } = gainLoss(stair, 3);
    expect(gain).toBeGreaterThan(90);
    expect(gain).toBeLessThanOrEqual(100);
  });

  it("separates gain from loss over a summit", () => {
    const up = Array.from({ length: 51 }, (_, i) => 1000 + i * 10);
    const down = Array.from({ length: 51 }, (_, i) => 1500 - i * 10);
    const { gain, loss } = gainLoss([...up, ...down], 3);
    expect(gain).toBeCloseTo(500, 0);
    expect(loss).toBeCloseTo(500, 0);
  });

  it("never overstates gain, only understates it within the band", () => {
    const climb = Array.from({ length: 50 }, (_, i) => 1000 + i * 7);
    const trueGain = 49 * 7;
    const { gain } = gainLoss(climb, 3);
    expect(gain).toBeLessThanOrEqual(trueGain);
    expect(gain).toBeGreaterThanOrEqual(trueGain - 3);
  });
});

describe("computeStats", () => {
  const track: RawPoint[] = Array.from({ length: 100 }, (_, i) => ({
    lat: 46.5 + i * 0.0001,
    lon: 8.0,
    ele: 1000 + i * 5,
    t: i * 10_000,
  }));

  it("computes distance, gain and duration together", () => {
    const s = computeStats(track);
    expect(s.distanceM).toBeGreaterThan(1000);
    expect(s.gainM).toBeGreaterThan(480);
    expect(s.lossM).toBe(0);
    expect(s.durationS).toBe(990);
    expect(s.minEleM).toBe(1000);
    expect(s.maxEleM).toBe(1495);
  });

  it("excludes long stops from moving time", () => {
    const withStop: RawPoint[] = [
      { lat: 46.5, lon: 8.0, ele: 1000, t: 0 },
      { lat: 46.5, lon: 8.0, ele: 1000, t: 3_600_000 }, // one hour parked
      { lat: 46.51, lon: 8.0, ele: 1000, t: 3_660_000 },
    ];
    const s = computeStats(withStop);
    expect(s.durationS).toBe(3660);
    expect(s.movingS).toBeLessThan(120);
  });

  it("returns null timings for an untimed track", () => {
    const s = computeStats([
      { lat: 46.5, lon: 8.0, ele: 1000, t: null },
      { lat: 46.51, lon: 8.0, ele: 1100, t: null },
    ]);
    expect(s.durationS).toBeNull();
    expect(s.movingS).toBeNull();
    expect(s.distanceM).toBeGreaterThan(0);
  });

  it("handles an empty track without throwing", () => {
    expect(computeStats([]).distanceM).toBe(0);
  });
});

describe("cumulativeDistances", () => {
  it("starts at zero and increases monotonically", () => {
    const d = cumulativeDistances([
      { lat: 46.5, lon: 8.0, ele: null, t: null },
      { lat: 46.51, lon: 8.0, ele: null, t: null },
      { lat: 46.52, lon: 8.0, ele: null, t: null },
    ]);
    expect(d[0]).toBe(0);
    expect(d[1]).toBeGreaterThan(0);
    expect(d[2]).toBeGreaterThan(d[1]);
  });
});

// --------------------------------------------------------------------------
// simplification
// --------------------------------------------------------------------------

describe("douglasPeuckerIndices", () => {
  it("collapses a straight line to its endpoints", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lon: 8 + i * 0.001, lat: 46.5 }));
    expect(douglasPeuckerIndices(line, 10)).toEqual([0, 49]);
  });

  it("keeps a corner that exceeds the tolerance", () => {
    const corner = [
      { lon: 8.0, lat: 46.5 },
      { lon: 8.01, lat: 46.51 },
      { lon: 8.02, lat: 46.5 },
    ];
    expect(douglasPeuckerIndices(corner, 10)).toHaveLength(3);
  });

  it("always retains both endpoints", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({
      lon: 8 + Math.sin(i / 9) * 0.01,
      lat: 46.5 + Math.cos(i / 7) * 0.01,
    }));
    const idx = douglasPeuckerIndices(pts, 50);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(199);
  });
});

describe("simplifyToTarget", () => {
  const wiggly = Array.from({ length: 12_000 }, (_, i) => ({
    lon: 8 + i * 0.00001 + Math.sin(i / 40) * 0.0004,
    lat: 46.5 + Math.cos(i / 30) * 0.0004,
  }));

  it("meets the point budget for a dense track", () => {
    const { indices } = simplifyToTarget(wiggly, 3000);
    expect(indices.length).toBeLessThanOrEqual(3000);
    expect(indices.length).toBeGreaterThan(100);
  });

  it("passes short tracks through untouched", () => {
    const short = wiggly.slice(0, 50);
    const { indices, toleranceM } = simplifyToTarget(short, 3000);
    expect(indices).toHaveLength(50);
    expect(toleranceM).toBe(0);
  });

  it("adapts the tolerance to track scale", () => {
    // A tiny approach and a long tour must both hit the same budget.
    const tiny = Array.from({ length: 8000 }, (_, i) => ({
      lon: 8 + i * 0.0000001,
      lat: 46.5 + Math.sin(i / 50) * 0.000005,
    }));
    const { indices } = simplifyToTarget(tiny, 500);
    expect(indices.length).toBeLessThanOrEqual(500);
  });
});

// --------------------------------------------------------------------------
// terrain
// --------------------------------------------------------------------------

describe("decodeElevation", () => {
  it("decodes terrarium sea level", () => {
    // 32768 -> 128 * 256 + 0 + 0 = 32768 - 32768 = 0
    expect(decodeElevation(128, 0, 0, "terrarium")).toBeCloseTo(0, 5);
  });

  it("decodes a known terrarium summit height", () => {
    // Mont Blanc, 4808 m: 32768 + 4808 = 37576 = 146*256 + 200
    expect(decodeElevation(146, 200, 0, "terrarium")).toBeCloseTo(4808, 5);
  });

  it("decodes mapbox sea level", () => {
    // -10000 + (R*65536 + G*256 + B) * 0.1 = 0  ->  value 100000
    expect(decodeElevation(1, 134, 160, "mapbox")).toBeCloseTo(0, 5);
  });

  it("gives materially different answers for the two encodings", () => {
    // This is the whole reason encoding is explicit: the wrong one is silent.
    const terrarium = decodeElevation(146, 200, 0, "terrarium");
    const mapbox = decodeElevation(146, 200, 0, "mapbox");
    expect(Math.abs(terrarium - mapbox)).toBeGreaterThan(900_000);
  });
});

describe("lonLatToTile", () => {
  it("puts 0,0 at the centre of the world at z=1", () => {
    const { x, y } = lonLatToTile(0, 0, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("puts the antimeridian at the western edge", () => {
    expect(lonLatToTile(-180, 0, 2).x).toBeCloseTo(0, 6);
  });
});

describe("bilinearSample", () => {
  it("reads a constant tile as its constant", () => {
    const tile = flatTile(2500);
    expect(bilinearSample(tile, 3.5, 3.5, "terrarium")).toBeCloseTo(2500, 1);
  });

  it("clamps at tile edges instead of reading out of bounds", () => {
    const tile = flatTile(1000);
    expect(bilinearSample(tile, 7.9, 7.9, "terrarium")).toBeCloseTo(1000, 1);
    expect(bilinearSample(tile, -5, -5, "terrarium")).toBeCloseTo(1000, 1);
  });
});

describe("sampleElevations", () => {
  const source: TerrainSourceConfig = {
    id: "test",
    url: "https://example.test/{z}/{x}/{y}.png",
    encoding: "terrarium",
    tileSize: 8,
    maxzoom: 12,
    attribution: "test",
  };

  it("batches requests by tile rather than by point", async () => {
    const seen: string[] = [];
    const coords = Array.from({ length: 500 }, (_, i) => ({
      lat: 46.5 + i * 0.000001,
      lon: 8.0 + i * 0.000001,
    }));

    const result = await sampleElevations(coords, source, async (url) => {
      seen.push(url);
      return flatTile(3000);
    });

    expect(result).toHaveLength(500);
    expect(result[0]).toBeCloseTo(3000, 1);
    // 500 nearby points must not become 500 fetches.
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it("yields nulls when a tile fails rather than failing the ingest", async () => {
    const result = await sampleElevations(
      [{ lat: 46.5, lon: 8.0 }],
      source,
      async () => null,
    );
    expect(result).toEqual([null]);
  });
});

describe("renderHeight", () => {
  it("lifts a track that would sink into a coarse DEM", () => {
    // GPS says 3000 m; the DEM puts the ground at 3020 m on this steep face.
    // Drawn at 3000 m the line would be buried inside the mesh.
    expect(renderHeight(3000, 3020, 15)).toBe(3035);
  });

  it("leaves a track above the surface alone", () => {
    expect(renderHeight(3100, 3000, 15)).toBe(3100);
  });

  it("falls back to GPS altitude when the DEM is unavailable", () => {
    expect(renderHeight(2500, null, 15)).toBe(2500);
  });

  it("falls back to the DEM when GPS altitude is missing", () => {
    expect(renderHeight(null, 2500, 15)).toBe(2515);
  });
});

// --------------------------------------------------------------------------
// profile and privacy
// --------------------------------------------------------------------------

describe("buildProfile", () => {
  const points: TrackPoint[] = Array.from({ length: 1000 }, (_, i) => ({
    lat: 46.5,
    lon: 8.0,
    ele: 1000 + i,
    demZ: 990 + i,
    t: i * 1000,
    d: i * 10,
  }));

  it("resamples to the requested number of points", () => {
    expect(buildProfile(points, 500)).toHaveLength(500);
  });

  it("spaces samples evenly by distance, not by sample index", () => {
    const prof = buildProfile(points, 100);
    const gaps = prof.slice(1).map((p, i) => p.d - prof[i].d);
    const first = gaps[0];
    for (const g of gaps) expect(Math.abs(g - first)).toBeLessThanOrEqual(1);
  });

  it("spans the whole track", () => {
    const prof = buildProfile(points, 50);
    expect(prof[0].d).toBe(0);
    expect(prof[prof.length - 1].d).toBe(9990);
  });

  it("handles a single-point track", () => {
    expect(buildProfile([points[0]], 500)).toHaveLength(1);
  });
});

describe("trimForPrivacy", () => {
  const points: TrackPoint[] = Array.from({ length: 100 }, (_, i) => ({
    lat: 46.5 + i * 0.001,
    lon: 8.0,
    ele: 1000,
    demZ: null,
    t: null,
    d: i * 100, // 10 km total
  }));

  it("removes both ends and re-bases distance", () => {
    const out = trimForPrivacy(points, 1000);
    expect(out[0].d).toBe(0);
    expect(out[0].lat).toBeGreaterThan(points[0].lat);
    expect(out[out.length - 1].lat).toBeLessThan(points[99].lat);
  });

  it("refuses to trim a track shorter than the trim radius", () => {
    expect(trimForPrivacy(points, 9000)).toHaveLength(100);
  });

  it("is a no-op at zero radius", () => {
    expect(trimForPrivacy(points, 0)).toHaveLength(100);
  });
});

// --------------------------------------------------------------------------
// end-to-end
// --------------------------------------------------------------------------

describe("ingestGpx", () => {
  // 600 samples at 20 s spacing: ~1.6 km ground distance climbing ~480 m,
  // which is a ~30% grade — a steep but real alpine ascent.
  const ascent = gpxOf(
    Array.from({ length: 600 }, (_, i) => ({
      lat: 46.5 + i * 0.00002,
      lon: 8.0 + i * 0.00002,
      ele: 1500 + i * 0.8,
      time: new Date(Date.UTC(2025, 6, 14, 6, 0, 0) + i * 20_000).toISOString(),
    })),
  );

  it("produces geometry, stats and a profile from a real-shaped file", async () => {
    const r = await ingestGpx(ascent, { targetPoints: 200, profileSamples: 100 });

    expect(r.name).toBe("Test Track");
    expect(r.line.length).toBeLessThanOrEqual(200);
    expect(r.line[0]).toHaveLength(3);
    expect(r.profile).toHaveLength(100);
    expect(r.stats.gainM).toBeGreaterThan(450);
    expect(r.stats.lossM).toBe(0);
    expect(r.stats.distanceM).toBeGreaterThan(1500);
    expect(r.stats.distanceM).toBeLessThan(1800);
    expect(r.stats.maxGrade).toBeGreaterThan(0.2);
    expect(r.bbox.minLat).toBeLessThan(r.bbox.maxLat);
    expect(r.demSampled).toBe(false);
  });

  it("clamps route height above the DEM when terrain is available", async () => {
    const source: TerrainSourceConfig = {
      id: "test",
      url: "https://example.test/{z}/{x}/{y}.png",
      encoding: "terrarium",
      tileSize: 8,
      maxzoom: 12,
      attribution: "test",
    };
    // Terrain sits well above the recorded GPS altitudes, so every vertex
    // must be lifted to the surface plus clearance.
    const r = await ingestGpx(ascent, {
      targetPoints: 100,
      terrain: { source, fetchTile: async () => flatTile(4000) },
      clearanceM: 15,
    });

    expect(r.demSampled).toBe(true);
    for (const [, , z] of r.line) expect(z).toBeCloseTo(4015, 0);
  });

  it("applies privacy trimming before geometry is built", async () => {
    const full = await ingestGpx(ascent, { targetPoints: 500 });
    const trimmed = await ingestGpx(ascent, { targetPoints: 500, privacyStartM: 300 });

    expect(trimmed.line[0][1]).toBeGreaterThan(full.line[0][1]);
    expect(trimmed.privacyStartM).toBe(300);
  });

  it("reports what it dropped instead of hiding it", async () => {
    const dirty = gpxOf([
      { lat: 0, lon: 0, ele: 0 },
      { lat: 46.5, lon: 8.0, ele: 1500 },
      { lat: 46.51, lon: 8.01, ele: 1600 },
    ]);
    const r = await ingestGpx(dirty);
    expect(r.dropped.implausible).toBe(1);
  });

  it("refuses a track with too few usable points", async () => {
    await expect(ingestGpx(gpxOf([{ lat: 46.5, lon: 8.0 }]))).rejects.toThrow(
      /fewer than two/,
    );
  });
});

describe("computeStats maxGrade", () => {
  it("measures grade over a sustained run", () => {
    // 2 m horizontal per step, 1 m rise per step: a steady 50% grade.
    const pts: RawPoint[] = Array.from({ length: 200 }, (_, i) => ({
      lat: 46.5 + i * 0.000018,
      lon: 8.0,
      ele: 1000 + i,
      t: i * 1000,
    }));
    const s = computeStats(pts, { gradeWindowM: 30 });
    expect(s.maxGrade).not.toBeNull();
    expect(s.maxGrade!).toBeGreaterThan(0.3);
    expect(s.maxGrade!).toBeLessThan(0.8);
  });

  it("is not fooled by a single-sample elevation spike", () => {
    // One 40 m blip between samples 2 m apart would read as a 2000% grade
    // if grade were measured per sample instead of over a window.
    const pts: RawPoint[] = Array.from({ length: 100 }, (_, i) => ({
      lat: 46.5 + i * 0.000018,
      lon: 8.0,
      ele: i === 50 ? 1040 : 1000,
      t: i * 1000,
    }));
    const s = computeStats(pts, { gradeWindowM: 30 });
    expect(s.maxGrade!).toBeLessThan(1.5);
  });

  it("is null for a track with no elevation data", () => {
    const pts: RawPoint[] = Array.from({ length: 50 }, (_, i) => ({
      lat: 46.5 + i * 0.0001,
      lon: 8.0,
      ele: null,
      t: null,
    }));
    expect(computeStats(pts).maxGrade).toBeNull();
  });
});
