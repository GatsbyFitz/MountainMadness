import { describe, expect, it } from "vitest";

import { CARD_HEIGHT, CARD_WIDTH, cardFilename, coverCrop, layoutCard } from "./share-card";

describe("layoutCard", () => {
  it("uses Instagram's 4:5 portrait", () => {
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(0.8, 3);
  });

  it("splits into a map area and a panel that exactly tile the card", () => {
    const { map, panel } = layoutCard();
    expect(map.h + panel.h).toBe(CARD_HEIGHT);
    expect(panel.y).toBe(map.h);
    expect(map.w).toBe(CARD_WIDTH);
  });

  it("gives the map the majority of the height", () => {
    const { map } = layoutCard();
    expect(map.h / CARD_HEIGHT).toBeGreaterThan(0.7);
  });
});

describe("coverCrop", () => {
  it("crops the sides of a wide source", () => {
    // The map canvas is landscape; the card's map area is nearly square.
    const c = coverCrop(1600, 900, 1080, 999);
    expect(c.sh).toBe(900);
    expect(c.sw).toBeLessThan(1600);
    expect(c.sx).toBeGreaterThan(0);
    expect(c.sy).toBe(0);
  });

  it("crops top and bottom of a tall source", () => {
    const c = coverCrop(900, 1600, 1080, 999);
    expect(c.sw).toBe(900);
    expect(c.sh).toBeLessThan(1600);
    expect(c.sy).toBeGreaterThan(0);
  });

  it("centres the crop, so an auto-framed route stays in frame", () => {
    const c = coverCrop(1600, 900, 1080, 999);
    // Integer pixels, so allow the half-pixel that rounding costs.
    expect(Math.abs(c.sx - (1600 - c.sw) / 2)).toBeLessThanOrEqual(1);
  });

  it("is a no-op when aspects already match", () => {
    const c = coverCrop(1080, 1350, 1080, 1350);
    expect(c).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1350 });
  });

  it("never crops outside the source", () => {
    for (const [w, h] of [[1600, 900], [900, 1600], [1000, 1000], [3000, 400]] as const) {
      const c = coverCrop(w, h, 1080, 999);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.sw).toBeLessThanOrEqual(w);
      expect(c.sy + c.sh).toBeLessThanOrEqual(h);
    }
  });
});

describe("cardFilename", () => {
  it("slugifies a title with accents and punctuation", () => {
    expect(cardFilename("Mont Blanc — Italian Route via Gonella")).toBe(
      "mont-blanc-italian-route-via-gonella.png",
    );
  });

  it("falls back when a title slugifies to nothing", () => {
    expect(cardFilename("———")).toBe("trip.png");
  });

  it("bounds the length", () => {
    expect(cardFilename("x".repeat(300)).length).toBeLessThanOrEqual(64);
  });
});
