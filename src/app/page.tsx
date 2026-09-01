import Link from "next/link";

import { getStore } from "@/lib/store";
import { km, metres, shortDate } from "@/lib/format";

export default async function HomePage() {
  const store = getStore();
  const trips = await store.listTrips();
  const peaks = await store.listPeaks();
  const peakById = new Map(peaks.map((p) => [p.id, p]));

  // Resolve the tracks up front rather than awaiting inside the render: an
  // array of promises in children is not a rendering contract worth relying on.
  const tracks = new Map(
    await Promise.all(
      trips.map(async (t) => [t.id, await store.getTrackByTrip(t.id)] as const),
    ),
  );

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Trips</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every route you log, drawn on the mountain it was climbed on.
        </p>
      </div>

      {trips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 p-10 text-center">
          <p className="text-slate-300">No trips yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Run <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">npx tsx scripts/seed.ts</code>{" "}
            for a demo route, or{" "}
            <Link href="/trips/new" className="text-orange-400 hover:underline">
              upload a GPX
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {trips.map((trip) => {
            const track = tracks.get(trip.id);
            const peak = trip.peakId ? peakById.get(trip.peakId) : null;
            return (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-700 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-medium text-slate-100">{trip.title}</h2>
                      {trip.visibility !== "public" && (
                        <span className="rounded border border-slate-700 px-1.5 py-px text-[10px] uppercase tracking-wide text-slate-500">
                          {trip.visibility}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {shortDate(trip.startedAt)}
                      {peak && ` · ${peak.name}`}
                      {trip.outcome && ` · ${trip.outcome}`}
                    </p>
                  </div>
                  {track && (
                    <dl className="flex shrink-0 gap-5 text-sm tabular-nums">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-slate-500">Dist</dt>
                        <dd className="text-slate-200">{km(track.stats.distanceM)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-slate-500">Up</dt>
                        <dd className="text-slate-200">{metres(track.stats.gainM)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider text-slate-500">High</dt>
                        <dd className="text-slate-200">{metres(track.stats.maxEleM)}</dd>
                      </div>
                    </dl>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
