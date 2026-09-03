import { describe, expect, it } from "vitest";

import { bearingBetween, frameTrack, zoomForBBox } from "./camera";
import type { BBox } from "@/lib/geo/types";

describe("bearingBetween", () => {
  it("reads due north as 0", () => {
    expect(bearingBetween(46.0, 8.0, 47.0, 8.0)).toBeCloseTo(0, 1);
  });

  it("reads due east as 90", () => {
    expect(bearingBetween(0, 0, 0, 1)).toBeCloseTo(90, 1);
  });

  it("reads due south as 180", () => {
    expect(bearingBetween(47.0, 8.0, 46.0, 8.0)).toBeCloseTo(180, 1);
  });

  it("reads due west as 270", () => {
    expect(bearingBetween(0, 0, 0, -1)).toBeCloseTo(270, 1);
  });

  it("always returns a positive bearing", () => {
    for (const [lat, lon] of [[45, -1], [45, -179], [-45, 179]] as const) {
      const b = bearingBetween(45, 0, lat, lon);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe("zoomForBBox", () => {
  const alpine: BBox = { minLon: 7.99, minLat: 45.99, maxLon: 8.01, maxLat: 46.01 };

  it("zooms in further for a smaller bbox", () => {
    const tight: BBox = { minLon: 7.999, minLat: 45.999, maxLon: 8.001, maxLat: 46.001 };
    expect(zoomForBBox(tight, 1200, 800)).toBeGreaterThan(zoomForBBox(alpine, 1200, 800));
  });

  it("stays within usable map zoom bounds", () => {
    const world: BBox = { minLon: -180, minLat: -80, maxLon: 180, maxLat: 80 };
    const speck: BBox = { minLon: 8, minLat: 46, maxLon: 8.00001, maxLat: 46.00001 };
    expect(zoomForBBox(world, 1200, 800)).toBeGreaterThanOrEqual(1);
    expect(zoomForBBox(speck, 1200, 800)).toBeLessThanOrEqual(18);
  });

  it("is constrained by the tighter of the two axes", () => {
    // A bbox that is wide but very short must not zoom in as if only height mattered.
    const wide: BBox = { minLon: 7.0, minLat: 45.999, maxLon: 9.0, maxLat: 46.001 };
    expect(zoomForBBox(wide, 1200, 800)).toBeLessThan(zoomForBBox(alpine, 1200, 800));
  });
});

describe("frameTrack", () => {
  const bbox: BBox = { minLon: 7.99, minLat: 45.99, maxLon: 8.01, maxLat: 46.01 };

  it("looks from the low end toward the high end", () => {
    // Climbs from the south-west corner to the north-east corner.
    const line: [number, number, number][] = [
      [7.99, 45.99, 1000],
      [8.0, 46.0, 2000],
      [8.01, 46.01, 3000],
    ];
    const view = frameTrack(line, bbox);
    // North-east is 45 degrees; allow slack for the great-circle correction.
    expect(view.bearing).toBeGreaterThan(20);
    expect(view.bearing).toBeLessThan(70);
  });

  it("reverses the bearing when the route descends the other way", () => {
    const line: [number, number, number][] = [
      [8.01, 46.01, 1000],
      [7.99, 45.99, 3000],
    ];
    const view = frameTrack(line, bbox);
    expect(view.bearing).toBeGreaterThan(200);
    expect(view.bearing).toBeLessThan(250);
  });

  it("pitches the camera by default so terrain reads as 3D", () => {
    const line: [number, number, number][] = [
      [7.99, 45.99, 1000],
      [8.01, 46.01, 3000],
    ];
    expect(frameTrack(line, bbox).pitch).toBe(65);
  });

  it("falls back to north-up on a track with no relief", () => {
    // A flat valley loop has no face to look at; picking a bearing from noise
    // would just spin the camera arbitrarily between reloads.
    const flat: [number, number, number][] = [
      [7.99, 45.99, 1000],
      [8.0, 46.0, 1002],
      [8.01, 46.01, 1001],
    ];
    const view = frameTrack(flat, bbox);
    expect(view.bearing).toBe(0);
  });

  it("handles a degenerate single-point track", () => {
    const view = frameTrack([[8.0, 46.0, 1000]], bbox);
    expect(Number.isFinite(view.zoom)).toBe(true);
    expect(view.bearing).toBe(0);
  });

  it("anchors between the centre and the low end, not past either", () => {
    const line: [number, number, number][] = [
      [7.99, 45.99, 1000],
      [8.01, 46.01, 3000],
    ];
    const view = frameTrack(line, bbox);
    expect(view.latitude).toBeLessThan(46.0);
    expect(view.latitude).toBeGreaterThan(45.99);
  });
});
