"use client";

// Exported with an underscore: deck.gl still marks terrain draping experimental.
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  MapLibreMap,
  NavigationControl,
  type ErrorEvent,
  type IControl,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import type { BBox, ProfilePoint } from "@/lib/geo/types";
import { getTerrainSource, type SkinId } from "@/lib/tiles/sources";
import { frameTrack } from "./camera";
import { buildStyle } from "./style";

import "maplibre-gl/dist/maplibre-gl.css";

export interface MountainViewerProps {
  line: [number, number, number][];
  bbox: BBox;
  profile?: ProfilePoint[];
  /** Index into `line` to highlight, driven by the elevation profile scrub. */
  highlightIndex?: number | null;
  basemap?: SkinId;
  className?: string;
  onReady?: () => void;
}

const ROUTE_COLOR: [number, number, number, number] = [255, 122, 41, 255];
const SHADOW_COLOR: [number, number, number, number] = [12, 22, 28, 130];

export default function MountainViewer({
  line,
  bbox,
  highlightIndex = null,
  basemap = "relief",
  className,
  onReady,
}: MountainViewerProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The overlay only exists after MapLibre fires "load". Without tracking that
  // in state, the layer effect below runs once against a null overlay and never
  // re-runs, so the route silently never draws.
  const [overlayReady, setOverlayReady] = useState(false);

  // --- map lifecycle: created once, never re-created on prop changes --------
  useEffect(() => {
    if (!container.current || mapRef.current) return;

    // deck.gl v9 requires WebGL2 regardless of overlay mode.
    const probe = document.createElement("canvas").getContext("webgl2");
    if (!probe) {
      setError("This browser has no WebGL2 support, which the 3D viewer requires.");
      return;
    }

    const terrain = getTerrainSource();
    const view = frameTrack(line, bbox, {
      width: container.current.clientWidth || 1200,
      height: container.current.clientHeight || 800,
    });

    const map = new MapLibreMap({
      container: container.current,
      style: buildStyle({ terrain, basemap }),
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      maxPitch: 85,
      // MSAA matters here: a thin route ribbon against a terrain mesh aliases
      // badly without it. Moved under canvasContextAttributes in MapLibre v5.
      canvasContextAttributes: { antialias: true, powerPreference: "high-performance" },
      attributionControl: { compact: true },
    });

    // Debug handle for diagnosing terrain/camera problems, which are hard to
    // reason about from outside the GL context. Opt-in, never on by default.
    if (process.env.NEXT_PUBLIC_DEBUG_MAP === "1") {
      (window as unknown as { __mm_map?: unknown; __mm_errors?: string[] }).__mm_map = map;
      const w = window as unknown as { __mm_errors?: string[] };
      w.__mm_errors = [];
      map.on("error", (e: ErrorEvent) => w.__mm_errors!.push(String(e.error?.message ?? e)));
    }

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.setTerrain({ source: "dem", exaggeration: 1.25 });

      // MEASURED, not assumed: with `interleaved: true` the deck layers are
      // created and marked visible but never reach the screen while MapLibre
      // terrain is enabled -- verified by pixel-sampling deck's output (0 route
      // pixels interleaved, ~3.8k non-interleaved) on maplibre-gl 5.24 +
      // deck.gl 9.3. MapLibre draws the terrain mesh in a pass that a custom
      // layer does not participate in, so the route is painted and then buried.
      //
      // Overlay mode composites deck on its own canvas above the map, which
      // renders the route correctly but WITHOUT depth occlusion: a section of
      // route behind a ridge still draws on top of it. That is a real
      // limitation, traded for a route that is visible at all. Revisit when
      // deck.gl supports MapLibre's terrain draping hooks.
      const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlay as unknown as IControl);
      overlayRef.current = overlay;
      setOverlayReady(true);
      if (process.env.NEXT_PUBLIC_DEBUG_MAP === "1") {
        (window as unknown as { __mm_overlay?: unknown }).__mm_overlay = overlay;
      }

      onReady?.();
    });

    map.on("error", (e: ErrorEvent) => {
      // Tile 404s are noisy and non-fatal; only surface real failures.
      const msg = (e.error as Error | undefined)?.message ?? "";
      if (msg && !/tile|404/i.test(msg)) setError(msg);
    });

    mapRef.current = map;

    return () => {
      overlayRef.current?.finalize();
      overlayRef.current = null;
      setOverlayReady(false);
      map.remove();
      mapRef.current = null;
    };
    // Deliberately mount-only: re-creating the map on every prop change would
    // reset the user's camera mid-interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- layers: rebuilt whenever the route or the scrub position changes -----
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || line.length < 2) return;

    const highlight =
      highlightIndex !== null && line[highlightIndex] ? line[highlightIndex] : null;

    overlay.setProps({
      layers: [
        // The drop shadow: the same path draped flat on the terrain surface,
        // directly beneath the ribbon. Without it the floating line has no
        // anchor and the eye cannot place it in depth -- this is what actually
        // sells the third dimension.
        new PathLayer<{ path: [number, number, number][] }>({
          id: "route-shadow",
          data: [{ path: line }],
          getPath: (d) => d.path,
          getColor: SHADOW_COLOR,
          getWidth: 3,
          widthUnits: "pixels",
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
          // Drapes the path onto the terrain mesh rather than leaving it at its
          // own z, which is exactly what a shadow should do.
          extensions: [new TerrainExtension()],
        }),

        // The route itself, at DEM-clamped altitude.
        new PathLayer<{ path: [number, number, number][] }>({
          id: "route",
          data: [{ path: line }],
          getPath: (d) => d.path,
          getColor: ROUTE_COLOR,
          getWidth: 5,
          // Screen-space width: a world-width line vanishes the moment you zoom
          // out far enough to see the whole face.
          widthUnits: "pixels",
          widthMinPixels: 3,
          billboard: true,
          capRounded: true,
          jointRounded: true,
        }),

        // Start and finish.
        new ScatterplotLayer<{ position: [number, number, number]; color: [number, number, number] }>({
          id: "route-ends",
          data: [
            { position: line[0], color: [255, 255, 255] as [number, number, number] },
            { position: line[line.length - 1], color: [255, 122, 41] as [number, number, number] },
          ],
          getPosition: (d) => d.position,
          getFillColor: (d) => d.color,
          getLineColor: [20, 30, 36],
          lineWidthMinPixels: 2,
          stroked: true,
          radiusUnits: "pixels",
          getRadius: 6,
          billboard: true,
        }),

        // Scrub marker, only present while the profile is being hovered.
        ...(highlight
          ? [
              new ScatterplotLayer<{ position: [number, number, number] }>({
                id: "route-cursor",
                data: [{ position: highlight }],
                getPosition: (d) => d.position,
                getFillColor: [255, 255, 255],
                getLineColor: [255, 122, 41],
                lineWidthMinPixels: 3,
                stroked: true,
                radiusUnits: "pixels",
                getRadius: 8,
                billboard: true,
              }),
            ]
          : []),
      ],
    });
  }, [line, highlightIndex, overlayReady]);

  if (error) {
    return (
      <div className={className} data-testid="viewer-error">
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-900 p-8 text-center">
          <p className="font-medium text-slate-200">The 3D viewer could not start</p>
          <p className="max-w-sm text-sm text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return <div ref={container} className={className} data-testid="viewer-canvas" />;
}
