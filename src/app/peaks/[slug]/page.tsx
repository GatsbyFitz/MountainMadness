import Link from "next/link";
import { notFound } from "next/navigation";

import { getStore } from "@/lib/store";
import { metres, shortDate } from "@/lib/format";

// Peak pages are the discovery surface: mostly static, good for SEO, and
// cheap to serve. Revalidate hourly rather than per request.
export const revalidate = 3600;

export default async function PeakPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = getStore();

  const peak = await store.getPeakBySlug(slug);
  if (!peak) notFound();

  const [routes, trips] = await Promise.all([
    store.listRoutesForPeak(peak.id),
    store.listTrips({ peakId: peak.id, visibility: "public" }),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <header>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          {[peak.rangeName, peak.countryCode].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-100">{peak.name}</h1>
        <dl className="mt-3 flex gap-7 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Elevation</dt>
            <dd className="tabular-nums text-slate-200">{metres(peak.elevationM)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Prominence</dt>
            <dd className="tabular-nums text-slate-200">{metres(peak.prominenceM)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Coordinates</dt>
            <dd className="tabular-nums text-slate-200">
              {peak.lat.toFixed(4)}, {peak.lon.toFixed(4)}
            </dd>
          </div>
        </dl>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Routes</h2>
        {routes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No routes recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
            {routes.map((r) => (
              <li key={r.id} className="bg-slate-900 px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <h3 className="font-medium text-slate-100">{r.name}</h3>
                  {r.grade && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-orange-300">
                      {r.grade}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{r.discipline}</span>
                  {r.verticalM && (
                    <span className="ml-auto text-xs tabular-nums text-slate-400">
                      {metres(r.verticalM)} vertical
                    </span>
                  )}
                </div>
                {r.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{r.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Public ascents
        </h2>
        {trips.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nobody has shared an ascent of this peak yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {trips.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/trips/${t.id}`}
                  className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 transition hover:border-slate-700"
                >
                  <span className="min-w-0 flex-1 truncate text-slate-100">{t.title}</span>
                  <span className="shrink-0 text-sm text-slate-500">{shortDate(t.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
