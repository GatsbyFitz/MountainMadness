"use client";

import { useCallback, useState } from "react";

import { cardFilename, drawShareCard, type ShareCardData } from "./share-card";

export interface ShareButtonProps {
  /** Returns the live WebGL canvases, already redrawn. Null until the map loads. */
  capture: (() => HTMLCanvasElement[]) | null;
  data: ShareCardData;
}

type State = "idle" | "working" | "shared" | "downloaded" | "error";

/**
 * Produces the share image and hands it to the OS.
 *
 * On mobile, navigator.share with a file opens the system sheet, where
 * Instagram appears alongside everything else — that is the whole Instagram
 * story for a web app, since Instagram exposes no web share target and its
 * publishing API is Business/Creator only. On desktop the sheet either does
 * not exist or refuses files, so we fall back to a download.
 */
export default function ShareButton({ capture, data }: ShareButtonProps) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!capture) return;
    setState("working");
    setMessage(null);

    try {
      const sources = capture();
      if (sources.length === 0) throw new Error("The map is not ready yet.");

      const canvas = document.createElement("canvas");
      drawShareCard(canvas, sources, data);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Could not encode the image.");

      const file = new File([blob], cardFilename(data.title), { type: "image/png" });

      // canShare({files}) is the only reliable test: several desktop browsers
      // expose navigator.share but reject file payloads.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: data.title,
          text: [data.title, data.peakName].filter(Boolean).join(" · "),
        });
        setState("shared");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      setState("downloaded");
      setMessage("Saved — open Instagram and pick it from your camera roll.");
    } catch (err) {
      // A user dismissing the share sheet rejects with AbortError; that is a
      // choice, not a failure.
      if ((err as Error).name === "AbortError") {
        setState("idle");
        return;
      }
      setState("error");
      setMessage((err as Error).message);
    }
  }, [capture, data]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={!capture || state === "working"}
        className="rounded-md border border-slate-700 bg-slate-900/85 px-3 py-1.5 text-xs text-slate-200 backdrop-blur transition hover:border-slate-500 hover:text-white disabled:opacity-40"
      >
        {state === "working" ? "Rendering…" : state === "shared" ? "Shared" : "Share image"}
      </button>
      {message && (
        <p
          className={`max-w-[260px] rounded border px-2 py-1 text-right text-[11px] backdrop-blur ${
            state === "error"
              ? "border-red-800 bg-red-950/80 text-red-200"
              : "border-slate-700 bg-slate-900/85 text-slate-300"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
