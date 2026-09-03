import type { TrackStats } from "@/lib/geo/types";

/**
 * Renders a trip as a shareable image.
 *
 * Instagram has no web share target and its publishing API only accepts
 * Business/Creator accounts, so "share to Instagram" from a web app means
 * producing a file and handing it to the OS share sheet. The image is
 * therefore the product, not a fallback — it has to stand on its own in a
 * feed, without the page around it.
 */

/** Instagram's portrait aspect (4:5) at the resolution it stops recompressing. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

export interface ShareCardData {
  title: string;
  peakName: string | null;
  date: string | null;
  outcome: string | null;
  stats: TrackStats;
  /** Marks the image when the route is a waypoint approximation. */
  approximate: boolean;
}

export interface CardLayout {
  /** Where the map render goes. */
  map: { x: number; y: number; w: number; h: number };
  /** The stats panel below it. */
  panel: { x: number; y: number; w: number; h: number };
}

/**
 * Splits the card into a map area and a stats panel.
 *
 * Kept pure and exported so the proportions can be asserted without a browser;
 * everything else here needs a canvas.
 */
export function layoutCard(width = CARD_WIDTH, height = CARD_HEIGHT): CardLayout {
  const panelH = Math.round(height * 0.26);
  return {
    map: { x: 0, y: 0, w: width, h: height - panelH },
    panel: { x: 0, y: height - panelH, w: width, h: panelH },
  };
}

/**
 * Scales a source image to *cover* a target box, returning the source crop.
 *
 * Cover rather than contain: the map canvas is landscape and the card's map
 * area is nearly square, so fitting would letterbox the mountain. Cropping
 * equally from both sides keeps the route, which is centred by the auto-framed
 * camera, in frame.
 */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;

  if (srcAspect > dstAspect) {
    // Source is wider: crop the sides.
    const sw = Math.round(srcH * dstAspect);
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH };
  }
  // Source is taller: crop top and bottom.
  const sh = Math.round(srcW / dstAspect);
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh };
}

const fmt = {
  km: (m: number) => `${(m / 1000).toFixed(1)}`,
  m: (v: number | null) => (v === null ? "—" : v.toLocaleString()),
};

/**
 * Draws the card. `sources` are the live WebGL canvases, composited in order.
 *
 * They must be captured while their drawing buffers are still valid — see
 * captureMapCanvases in MountainViewer, which forces a synchronous redraw
 * first. A canvas read after the frame is presented comes back transparent.
 */
export function drawShareCard(
  target: HTMLCanvasElement,
  sources: HTMLCanvasElement[],
  data: ShareCardData,
): void {
  target.width = CARD_WIDTH;
  target.height = CARD_HEIGHT;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const { map, panel } = layoutCard();

  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // --- map area ------------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(map.x, map.y, map.w, map.h);
  ctx.clip();
  for (const src of sources) {
    if (!src.width || !src.height) continue;
    const { sx, sy, sw, sh } = coverCrop(src.width, src.height, map.w, map.h);
    ctx.drawImage(src, sx, sy, sw, sh, map.x, map.y, map.w, map.h);
  }
  ctx.restore();

  // Fade the map into the panel so the join is not a hard seam.
  const fade = ctx.createLinearGradient(0, map.h - 160, 0, map.h);
  fade.addColorStop(0, "rgba(2,6,23,0)");
  fade.addColorStop(1, "#020617");
  ctx.fillStyle = fade;
  ctx.fillRect(0, map.h - 160, CARD_WIDTH, 160);

  // --- panel ---------------------------------------------------------------
  ctx.fillStyle = "#020617";
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  const pad = 64;
  let y = panel.y + 14;

  // Eyebrow: peak, date, outcome.
  const eyebrow = [data.peakName, data.date, data.outcome]
    .filter(Boolean)
    .join("  ·  ")
    .toUpperCase();
  if (eyebrow) {
    ctx.fillStyle = "#64748b";
    ctx.font = "500 24px ui-sans-serif, system-ui, -apple-system, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillText(eyebrow, pad, y + 26);
    ctx.letterSpacing = "0px";
  }
  y += 62;

  // Title, shrinking to fit rather than overflowing the card.
  ctx.fillStyle = "#f1f5f9";
  let titleSize = 60;
  do {
    ctx.font = `700 ${titleSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    titleSize -= 2;
  } while (ctx.measureText(data.title).width > CARD_WIDTH - pad * 2 && titleSize > 30);
  ctx.fillText(data.title, pad, y + titleSize);
  y += titleSize + 46;

  // Stats row.
  const cells: [string, string, string][] = [
    ["Distance", fmt.km(data.stats.distanceM), "km"],
    ["Ascent", fmt.m(data.stats.gainM), "m"],
    ["High point", fmt.m(data.stats.maxEleM), "m"],
  ];
  const colW = (CARD_WIDTH - pad * 2) / cells.length;
  cells.forEach(([label, value, unit], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = "#64748b";
    ctx.font = "500 22px ui-sans-serif, system-ui, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.letterSpacing = "0px";

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 54px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(value, x, y + 58);
    const vw = ctx.measureText(value).width;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 26px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(unit, x + vw + 8, y + 58);
  });

  // Footer: wordmark, and the approximation caveat travels with the image.
  const footY = CARD_HEIGHT - 30;
  ctx.font = "700 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText("Mountain", pad, footY);
  const mw = ctx.measureText("Mountain").width;
  ctx.fillStyle = "#fb923c";
  ctx.fillText("Madness", pad + mw, footY);

  if (data.approximate) {
    ctx.fillStyle = "#475569";
    ctx.font = "400 20px ui-sans-serif, system-ui, sans-serif";
    const note = "approximate route";
    ctx.fillText(note, CARD_WIDTH - pad - ctx.measureText(note).width, footY);
  }
}

/** Filename-safe slug for the downloaded/shared file. */
export function cardFilename(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "trip";
  return `${slug}.png`;
}
