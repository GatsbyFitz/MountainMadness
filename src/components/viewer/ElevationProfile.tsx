"use client";

import { useMemo, useRef, useState } from "react";

import type { ProfilePoint } from "@/lib/geo/types";

export interface ElevationProfileProps {
  profile: ProfilePoint[];
  /** Fraction 0..1 along the track, or null when not hovering. */
  onScrub?: (fraction: number | null) => void;
  className?: string;
}

const W = 800;
const H = 150;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

/**
 * Elevation profile, doubling as the scrub control for the 3D view.
 *
 * Plots the GPS series against the DEM series. Where they diverge you are
 * seeing the DEM's resolution limit rather than a recording error, and on
 * steep ground that gap is exactly why the drawn route is clamped upward.
 */
export default function ElevationProfile({
  profile,
  onScrub,
  className,
}: ElevationProfileProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (profile.length < 2) return null;

    const totalD = profile[profile.length - 1].d;
    const zs = profile.flatMap((p) =>
      p.demZ === null ? [p.z] : [p.z, p.demZ],
    );
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    // A dead-flat track would divide by zero; give it a nominal band.
    const span = maxZ - minZ < 10 ? 10 : maxZ - minZ;
    const lowZ = minZ - span * 0.08;
    const highZ = maxZ + span * 0.08;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const x = (d: number) => PAD.left + (d / Math.max(totalD, 1)) * plotW;
    const y = (z: number) => PAD.top + (1 - (z - lowZ) / (highZ - lowZ)) * plotH;

    const path = (key: "z" | "demZ") => {
      const pts = profile
        .map((p) => {
          const v = key === "z" ? p.z : p.demZ;
          return v === null ? null : `${x(p.d).toFixed(1)},${y(v).toFixed(1)}`;
        })
        .filter((s): s is string => s !== null);
      return pts.length ? `M${pts.join("L")}` : null;
    };

    const gpsPath = path("z");
    const area = gpsPath ? `${gpsPath}L${x(totalD).toFixed(1)},${(H - PAD.bottom).toFixed(1)}L${PAD.left},${(H - PAD.bottom).toFixed(1)}Z` : null;

    // Ticks at values the chart actually reaches.
    const ticks = [minZ, (minZ + maxZ) / 2, maxZ].map((z) => ({
      z: Math.round(z),
      y: y(z),
    }));

    return { x, y, totalD, gpsPath, demPath: path("demZ"), area, ticks, plotW };
  }, [profile]);

  if (!geom) {
    return (
      <div className={className}>
        <p className="p-4 text-sm text-slate-400">No elevation data for this track.</p>
      </div>
    );
  }

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const rel = ((clientX - rect.left) / rect.width) * W;
    const f = Math.max(0, Math.min(1, (rel - PAD.left) / geom.plotW));
    setCursor(f);
    onScrub?.(f);
  };

  const clear = () => {
    setCursor(null);
    onScrub?.(null);
  };

  const cursorPoint =
    cursor === null ? null : profile[Math.round(cursor * (profile.length - 1))];

  return (
    <div className={className}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Elevation profile: ${Math.round(geom.totalD / 100) / 10} km, ${geom.ticks[0].z} to ${geom.ticks[2].z} metres`}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={clear}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={clear}
      >
        {geom.ticks.map((t) => (
          <g key={t.z}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="currentColor"
              strokeWidth={1}
              className="text-slate-700"
            />
            <text
              x={PAD.left - 6}
              y={t.y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[10px] tabular-nums"
            >
              {t.z}
            </text>
          </g>
        ))}

        {geom.area && <path d={geom.area} className="fill-orange-500/15" />}

        {geom.demPath && (
          <path
            d={geom.demPath}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            className="stroke-slate-500"
          />
        )}
        {geom.gpsPath && (
          <path d={geom.gpsPath} fill="none" strokeWidth={2} className="stroke-orange-400" />
        )}

        {cursor !== null && cursorPoint && (
          <>
            <line
              x1={geom.x(cursorPoint.d)}
              x2={geom.x(cursorPoint.d)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              strokeWidth={1}
              className="stroke-white/70"
            />
            <circle
              cx={geom.x(cursorPoint.d)}
              cy={geom.y(cursorPoint.z)}
              r={4}
              className="fill-white stroke-orange-500"
              strokeWidth={2}
            />
          </>
        )}

        <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[10px] tabular-nums">
          0 km
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          className="fill-slate-500 text-[10px] tabular-nums"
        >
          {(geom.totalD / 1000).toFixed(1)} km
        </text>
      </svg>

      <div className="flex items-center gap-4 px-1 pt-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-orange-400" /> GPS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t border-dashed border-slate-500" /> terrain (DEM)
        </span>
        {cursorPoint && (
          <span className="ml-auto tabular-nums text-slate-300">
            {(cursorPoint.d / 1000).toFixed(2)} km &middot; {Math.round(cursorPoint.z)} m
          </span>
        )}
      </div>
    </div>
  );
}
