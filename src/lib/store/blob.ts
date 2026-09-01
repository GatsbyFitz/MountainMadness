import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Raw upload storage.
 *
 * The original file is kept immutable so ingest can be re-run after a parser
 * fix without asking the user to upload again.
 *
 * Production is Vercel Blob via *client* uploads: a Vercel Function has a hard
 * 4.5 MB request body limit, and a multi-day FIT file exceeds it, so the file
 * must go browser -> Blob directly and never through a function. This module
 * covers the server-side half (reading back what was stored, and the local-dev
 * substitute); the client handshake lives in the upload route.
 */

const BLOB_DIR = path.join(process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".data"), "blob");

export const usingVercelBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** Vercel Functions reject request bodies over this. */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

function safeKey(key: string): string {
  // Uploaded names must never escape the blob directory.
  const cleaned = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid blob key");
  }
  return cleaned;
}

export async function putBlob(key: string, body: string | Buffer): Promise<string> {
  if (usingVercelBlob()) {
    const { put } = await import("@vercel/blob");
    const { url } = await put(key, body, { access: "public", addRandomSuffix: true });
    return url;
  }

  const name = safeKey(key);
  await mkdir(BLOB_DIR, { recursive: true });
  await writeFile(path.join(BLOB_DIR, name), body);
  return `local://${name}`;
}

export async function getBlob(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("local://")) {
      return await readFile(path.join(BLOB_DIR, safeKey(url.slice("local://".length))));
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
