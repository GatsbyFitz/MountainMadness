import { getRasterLayer } from "@/lib/tiles/sources";

export const runtime = "nodejs";

/**
 * Imagery tile proxy.
 *
 * Same rationale as /api/dem: immutable tiles cached hard at the edge, vendor
 * keys kept server-side, and it works on networks that block tile hosts from
 * the browser but allow the app's own origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> },
) {
  const { layer, z, x, y } = await params;

  const config = getRasterLayer(layer);
  if (!config) {
    return new Response(`Unknown raster layer: ${layer}`, { status: 404 });
  }

  const zn = Number(z);
  const xn = Number(x);
  const yn = Number(y.replace(/\.(png|jpg|jpeg|webp)$/, ""));

  if (![zn, xn, yn].every((n) => Number.isInteger(n) && n >= 0) || zn > config.maxzoom) {
    return new Response("Bad tile coordinates", { status: 400 });
  }
  const max = 2 ** zn;
  if (xn >= max || yn >= max) {
    return new Response("Tile out of range", { status: 400 });
  }

  const upstream = config.url
    .replace("{z}", String(zn))
    .replace("{x}", String(xn))
    .replace("{y}", String(yn));

  try {
    const res = await fetch(upstream, {
      // Several tile services reject requests without a real UA.
      headers: {
        Accept: "image/*",
        "User-Agent": "MountainMadness/0.1 (+https://github.com/GatsbyFitz/MountainMadness)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return new Response(null, { status: res.status === 404 ? 404 : 502 });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=2592000, immutable",
        "X-Raster-Layer": config.id,
      },
    });
  } catch (err) {
    console.warn(`[raster] ${upstream}:`, (err as Error).message);
    return new Response(null, { status: 504 });
  }
}
