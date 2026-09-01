"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import type { BBox, ProfilePoint, TrackStats } from "@/lib/geo/types";
import ElevationProfile from "./ElevationProfile";

/**
 * MapLibre and deck.gl both touch `window` at import time, so the viewer can
 * only be loaded client-side. Doing it here also keeps ~400 KB of WebGL out of
 * every other page's bundle — the trip page's chrome renders and is readable
 * before the mountain arrives.
 */
const MountainViewer = dynamic(() => import("./MountainViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-900">
      <p className="text-sm text-slate-400">Loading terrain…</p>
    </div>
  ),
});

export interface ViewerShellProps {
  line: [number, number, number][];
  bbox: BBox;
  profile: ProfilePoint[];
  stats: TrackStats;
  demSampled: boolean;
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const STAT_CLASS = "text-lg font-semibold tabular-nums text-slate-100";
const LABEL_CLASS = "text-[10px] uppercase tracking-wider text-slate-500";

export default function ViewerShell({
  line,
  bbox,
  profile,
  stats,
  demSampled,
}: ViewerShellProps) {
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [basemap, setBasemap] = useState<"relief" | "osm">("relief");

  // The profile is resampled to even distance; the geometry is not. Map the
  // scrub fraction through distance so the marker lands where the cursor is.
  const handleScrub = useCallback(
    (fraction: number | null) => {
      if (fraction === null) {
        setHighlightIndex(null);
        return;
      }
      setHighlightIndex(Math.round(fraction * (line.length - 1)));
    },
    [line.length],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <MountainViewer
          key={basemap}
          line={line}
          bbox={bbox}
          highlightIndex={highlightIndex}
          basemap={basemap}
          className="h-full w-full"
        />

        <div className="pointer-events-auto absolute left-3 top-3 flex gap-1 rounded-md border border-slate-700 bg-slate-900/85 p-1 backdrop-blur">
          {(["relief", "osm"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setBasemap(mode)}
              aria-pressed={basemap === mode}
              className={`rounded px-2.5 py-1 text-xs transition ${
                basemap === mode
                  ? "bg-orange-500 text-slate-950"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {mode === "relief" ? "Relief" : "Map"}
            </button>
          ))}
        </div>

        {!demSampled && (
          <p className="absolute bottom-3 left-3 rounded border border-amber-700/50 bg-amber-950/80 px-2.5 py-1.5 text-[11px] text-amber-200 backdrop-blur">
            Terrain heights unavailable — route drawn at raw GPS altitude.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-800 bg-slate-800 sm:grid-cols-5">
        {[
          { label: "Distance", value: `${(stats.distanceM / 1000).toFixed(2)} km` },
          { label: "Ascent", value: `${stats.gainM.toLocaleString()} m` },
          { label: "Descent", value: `${stats.lossM.toLocaleString()} m` },
          { label: "High point", value: stats.maxEleM === null ? "—" : `${stats.maxEleM.toLocaleString()} m` },
          { label: "Moving", value: fmtDuration(stats.movingS) },
        ].map((s) => (
          <div key={s.label} className="bg-slate-900 px-3 py-2.5">
            <div className={LABEL_CLASS}>{s.label}</div>
            <div className={STAT_CLASS}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <ElevationProfile profile={profile} onScrub={handleScrub} />
      </div>
    </div>
  );
}
