import Link from "next/link";

import { getStore } from "@/lib/store";
import { metres } from "@/lib/format";

export default async function PeaksPage() {
  const store = getStore();
  const peaks = await store.listPeaks();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Peaks</h1>
        <p className="mt-1 text-sm text-slate-400">
          The shared registry. Seeded from OpenStreetMap; routes are contributed.
        </p>
      </div>

      {peaks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-10 text-center text-slate-400">
          No peaks yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
          {peaks.map((peak) => (
            <li key={peak.id}>
              <Link
                href={`/peaks/${peak.slug}`}
                className="flex items-center gap-4 bg-slate-900 px-4 py-3 transition hover:bg-slate-800/60"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium text-slate-100">{peak.name}</h2>
                  <p className="text-sm text-slate-500">
                    {[peak.rangeName, peak.countryCode].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums text-slate-300">
                  {metres(peak.elevationM)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
