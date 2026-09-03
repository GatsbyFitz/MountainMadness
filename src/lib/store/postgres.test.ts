import { describe, expect, it } from "vitest";

import { bboxToWkt, lineToWkt, wktToBBox, wktToLine } from "./postgres";

/**
 * The WKT boundary is the only place the app's `[lon, lat, z]` arrays meet
 * PostGIS. Getting the axis order wrong here would put every route in the wrong
 * hemisphere, silently, so it is worth pinning without a database.
 */
describe("geometry <-> WKT", () => {
  const line: [number, number, number][] = [
    [6.8652, 45.8326, 4808],
    [6.8608, 45.8336, 4650],
    [6.8489, 45.8345, 4250],
  ];

  it("writes LINESTRING Z in lon lat z order", () => {
    expect(lineToWkt(line)).toBe(
      "LINESTRING Z (6.8652 45.8326 4808,6.8608 45.8336 4650,6.8489 45.8345 4250)",
    );
  });

  it("round-trips a line", () => {
    expect(wktToLine(lineToWkt(line))).toEqual(line);
  });

  it("keeps longitude first, which is the opposite of how people say it", () => {
    const [lon, lat] = wktToLine(lineToWkt(line))[0];
    expect(lon).toBeCloseTo(6.8652);
    expect(lat).toBeCloseTo(45.8326);
  });

  it("refuses a degenerate line rather than writing invalid WKT", () => {
    expect(() => lineToWkt([[1, 2, 3]])).toThrow(/at least two/);
  });

  it("defaults a missing z to zero instead of NaN", () => {
    expect(wktToLine("LINESTRING(1 2,3 4)")).toEqual([
      [1, 2, 0],
      [3, 4, 0],
    ]);
  });

  it("round-trips a bbox", () => {
    const bbox = { minLon: 6.8, minLat: 45.8, maxLon: 6.9, maxLat: 45.9 };
    expect(wktToBBox(bboxToWkt(bbox))).toEqual(bbox);
  });

  it("closes the bbox ring", () => {
    const wkt = bboxToWkt({ minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 });
    const pts = wkt.slice(wkt.indexOf("((") + 2, wkt.indexOf("))")).split(",");
    expect(pts).toHaveLength(5);
    expect(pts[0].trim()).toBe(pts[4].trim());
  });

  it("handles southern-hemisphere negatives", () => {
    const nz: [number, number, number][] = [
      [168.8081, -45.0719, 2319],
      [168.8114, -45.0503, 1610],
    ];
    expect(wktToLine(lineToWkt(nz))).toEqual(nz);
  });
});
