import { NextResponse } from "next/server";

import { ingestUpload } from "@/lib/ingest";
import { VERCEL_BODY_LIMIT_BYTES, usingVercelBlob } from "@/lib/store/blob";
import { ReadOnlyStoreError } from "@/lib/store/errors";
import { DEMO_USER_ID } from "@/lib/demo";

// DEM sampling per point is the slow step. 60s is the Hobby ceiling and is
// valid on every plan; Pro allows up to 800s, so raise this if long traverses
// start timing out.
export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Server-upload ingest path.
 *
 * This is the local-dev and small-file route. In production the browser PUTs
 * straight to Vercel Blob (client uploads) and a webhook drives ingest,
 * because a Vercel Function cannot accept a body over 4.5 MB — see
 * src/lib/store/blob.ts.
 */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > VERCEL_BODY_LIMIT_BYTES) {
    return NextResponse.json(
      {
        error: "File too large for the server-upload path.",
        detail:
          "Vercel Functions cap request bodies at 4.5 MB. Use the client-upload " +
          "flow so the file goes straight to Blob storage.",
      },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const privacyRaw = Number(form.get("privacyStartM") ?? 0);
  const privacyStartM = Number.isFinite(privacyRaw)
    ? Math.max(0, Math.min(5000, privacyRaw))
    : 0;

  const xml = await file.text();

  try {
    const summary = await ingestUpload({
      filename: file.name || "upload.gpx",
      xml,
      userId: DEMO_USER_ID,
      privacyStartM,
      visibility: form.get("visibility") === "public" ? "public" : "private",
    });
    return NextResponse.json({ ...summary, storage: usingVercelBlob() ? "blob" : "local" });
  } catch (err) {
    // A read-only host is an operator problem, not a bad file: 503, not 422.
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    // Parse and validation failures are the user's problem to fix, so say what
    // went wrong rather than returning a bare 500.
    return NextResponse.json(
      { error: (err as Error).message || "Ingest failed." },
      { status: 422 },
    );
  }
}
