import { NextResponse } from "next/server";

import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Track geometry for the viewer.
 *
 * Served from its own endpoint rather than serialised into the trip page's RSC
 * payload: it is large, it is independently cacheable, and only the viewer
 * island needs it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { tripId } = await params;
  const store = getStore();

  const trip = await store.getTrip(tripId);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const track = await store.getTrackByTrip(tripId);
  if (!track) {
    return NextResponse.json({ error: "No track for this trip" }, { status: 404 });
  }

  return NextResponse.json(
    {
      line: track.line,
      bbox: track.bbox,
      stats: track.stats,
      profile: track.profile,
      demSampled: track.demSampled,
      privacyStartM: track.privacyStartM,
    },
    {
      headers: {
        // Geometry is immutable once ingested; a re-ingest creates a new track.
        "Cache-Control": trip.visibility === "public"
          ? "public, s-maxage=86400, stale-while-revalidate=604800"
          : "private, no-store",
      },
    },
  );
}
