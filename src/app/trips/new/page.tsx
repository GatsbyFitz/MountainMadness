"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface UploadResult {
  tripId: string;
  name: string | null;
  points: number;
  demSampled: boolean;
  dropped: { implausible: number; duplicate: number; teleport: number };
}

export default function NewTripPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ? `${body.error} ${body.detail}` : body.error);
        return;
      }
      setResult(body as UploadResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Upload a track</h1>
        <p className="mt-1 text-sm text-slate-400">
          A GPX from your watch or phone. We parse it, sample the terrain along it, and
          compute the stats — you confirm the rest.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium text-slate-200">
            GPX file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            required
            className="rounded-md border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-200"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="privacyStartM" className="text-sm font-medium text-slate-200">
            Privacy trim
          </label>
          <select
            id="privacyStartM"
            name="privacyStartM"
            defaultValue="0"
            className="rounded-md border border-slate-700 bg-slate-900 p-2.5 text-sm text-slate-300"
          >
            <option value="0">None</option>
            <option value="200">200 m from each end</option>
            <option value="500">500 m from each end</option>
            <option value="1000">1 km from each end</option>
          </select>
          <p className="text-xs text-slate-500">
            Trimmed on the server before the track is stored, so the hidden section never
            reaches a browser.
          </p>
        </div>

        <label className="flex items-start gap-2.5 text-sm text-slate-300">
          <input
            type="checkbox"
            name="visibility"
            value="public"
            className="mt-0.5 accent-orange-500"
          />
          <span>
            Make this trip public
            <span className="block text-xs text-slate-500">
              Trips are private by default.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-orange-500 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-orange-400 disabled:opacity-50"
        >
          {busy ? "Processing…" : "Upload and process"}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-900 bg-red-950/60 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-medium text-slate-100">{result.name ?? "Track processed"}</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Vertices kept</dt>
            <dd className="tabular-nums text-slate-200">{result.points}</dd>
            <dt className="text-slate-500">Terrain sampled</dt>
            <dd className="text-slate-200">{result.demSampled ? "yes" : "no"}</dd>
            <dt className="text-slate-500">Points dropped</dt>
            <dd className="tabular-nums text-slate-200">
              {result.dropped.implausible + result.dropped.duplicate + result.dropped.teleport}
              <span className="ml-1 text-xs text-slate-500">
                ({result.dropped.implausible} bad, {result.dropped.duplicate} dup,{" "}
                {result.dropped.teleport} jump)
              </span>
            </dd>
          </dl>
          <button
            type="button"
            onClick={() => router.push(`/trips/${result.tripId}`)}
            className="self-start rounded-md border border-orange-500 px-3 py-1.5 text-sm text-orange-300 transition hover:bg-orange-500 hover:text-slate-950"
          >
            View in 3D →
          </button>
        </div>
      )}
    </div>
  );
}
