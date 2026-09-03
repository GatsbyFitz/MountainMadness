import Link from "next/link";
import { notFound } from "next/navigation";

import ViewerShell from "@/components/viewer/ViewerShell";
import { getStore } from "@/lib/store";
import { shortDate } from "@/lib/format";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();

  const trip = await store.getTrip(id);
  if (!trip) notFound();

  const [track, peak] = await Promise.all([
    store.getTrackByTrip(trip.id),
    trip.peakId ? store.getPeak(trip.peakId) : Promise.resolve(null),
  ]);

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{trip.title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {shortDate(trip.startedAt)}
            {peak && (
              <>
                {" · "}
                <Link href={`/peaks/${peak.slug}`} className="text-orange-400 hover:underline">
                  {peak.name}
                </Link>
              </>
            )}
            {trip.outcome && ` · ${trip.outcome}`}
          </p>
        </div>
        <span className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
          {trip.visibility}
        </span>
      </header>

      {track ? (
        <ViewerShell
          line={track.line}
          bbox={track.bbox}
          profile={track.profile}
          stats={track.stats}
          demSampled={track.demSampled}
          source={track.source}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-slate-400">
          This trip has no GPS track yet.
        </p>
      )}

      {trip.notes && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-[10px] uppercase tracking-wider text-slate-500">Notes</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{trip.notes}</p>
        </section>
      )}

      {track?.privacyStartM ? (
        <p className="text-xs text-slate-500">
          {track.privacyStartM} m trimmed from each end of this track for privacy.
        </p>
      ) : null}
    </article>
  );
}
