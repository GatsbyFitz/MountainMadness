import { getUpstreamTerrainSource } from "@/lib/tiles/sources";

export const runtime = "nodejs";

/**
 * DEM tile proxy.
 *
 * Three reasons this exists rather than pointing the viewer straight at a tile
 * host:
 *
 *   1. Caching. Terrain tiles are immutable, so a long s-maxage at the edge
 *      turns repeat views into cache hits instead of vendor-billed requests --
 *      the direct lever on the tile-cost risk.
 *   2. Key hygiene. Paid sources need an API key in the URL; proxying keeps it
 *      server-side instead of shipping it in the client bundle.
 *   3. Egress. Some networks block or throttle direct tile-host access from
 *      the browser while allowing the app's own origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;

  // Path segments go into an outbound URL: allow digits only.
  const zn = Number(z);
  const xn = Number(x);
  const yn = Number(y.replace(/\.(png|webp)$/, ""));

  if (![zn, xn, yn].every((n) => Number.isInteger(n) && n >= 0) || zn > 22) {
    return new Response("Bad tile coordinates", { status: 400 });
  }
  const max = 2 ** zn;
  if (xn >= max || yn >= max) {
    return new Response("Tile out of range", { status: 400 });
  }

  const source = getUpstreamTerrainSource();
  const upstream = source.url
    .replace("{z}", String(zn))
    .replace("{x}", String(xn))
    .replace("{y}", String(yn));

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "image/png,image/webp,image/*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return new Response(null, { status: res.status === 404 ? 404 : 502 });
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/png",
        // Immutable for a given z/x/y: cache hard.
        "Cache-Control": "public, max-age=3600, s-maxage=2592000, immutable",
        "X-Terrain-Source": source.id,
        "X-Terrain-Encoding": source.encoding,
      },
    });
  } catch (err) {
    console.warn(`[dem-proxy] ${upstream}:`, (err as Error).message);
    return new Response(null, { status: 504 });
  }
}
