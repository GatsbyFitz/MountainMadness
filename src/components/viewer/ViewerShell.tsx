"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import type { BBox, ProfilePoint, TrackStats } from "@/lib/geo/types";
import { RASTER_LAYERS, SKINS, type SkinId } from "@/lib/tiles/sources";
import ElevationProfile from "./ElevationProfile";
import ShareButton from "./ShareButton";

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
  /** "drawn" means the line is an approximation, not a recorded track. */
  source?: string;
  /** Card metadata for the shareable image. */
  title?: string;
  peakName?: string | null;
  date?: string | null;
  outcome?: string | null;
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
  source,
  title,
  peakName,
  date,
  outcome,
}: ViewerShellProps) {
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [basemap, setBasemap] = useState<SkinId>("relief");
  // Held in state, not a ref: the share button must re-render enabled once the
  // map hands over its capture function.
  const [capture, setCapture] = useState<(() => HTMLCanvasElement[]) | null>(null);

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
          // Wrapped: a bare function passed to a state setter would be called
          // as an updater instead of stored.
          onCaptureReady={(fn) => setCapture(() => fn)}
        />

        {title && (
          <div className="absolute right-3 top-3 z-10">
            <ShareButton
              capture={capture}
              data={{
                title,
                peakName: peakName ?? null,
                date: date ?? null,
                outcome: outcome ?? null,
                stats,
                approximate: source === "drawn",
              }}
            />
          </div>
        )}

        <div className="pointer-events-auto absolute left-3 top-3 flex gap-1 rounded-md border border-slate-700 bg-slate-900/85 p-1 backdrop-blur">
          {SKINS.map((skin) => {
            const layer = skin === "relief" ? null : RASTER_LAYERS[skin];
            return (
              <button
                key={skin}
                type="button"
                onClick={() => setBasemap(skin)}
                aria-pressed={basemap === skin}
                title={layer?.note ?? "Hypsometric tint from the elevation model"}
                className={`rounded px-2.5 py-1 text-xs transition ${
                  basemap === skin
                    ? "bg-orange-500 text-slate-950"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {layer?.label ?? "Relief"}
              </button>
            );
          })}
        </div>

        {/* Stacked bottom-left so they never collide with each other or with
            MapLibre's attribution control in the bottom-right. */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[60%] flex-col gap-1.5">
          {!demSampled && (
            <p className="rounded border border-amber-700/50 bg-amber-950/85 px-2.5 py-1.5 text-[11px] text-amber-200 backdrop-blur">
              Terrain heights unavailable — route drawn at raw GPS altitude.
            </p>
          )}
          {source === "drawn" && (
            <p className="rounded border border-slate-600 bg-slate-900/85 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur">
              Approximate line — drawn from waypoints, not a recorded GPS track.
            </p>
          )}
        </div>
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
