import { LocalStore } from "./local";
import type { Store } from "./types";

export * from "./types";

let cached: Store | null = null;

/**
 * Picks the storage backend.
 *
 * With DATABASE_URL set the Postgres/PostGIS implementation belongs here; it
 * is not written yet, so we say so rather than falling through to the local
 * store and silently writing a production upload to a JSON file on an
 * ephemeral serverless filesystem.
 */
export function getStore(): Store {
  if (cached) return cached;

  if (process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is set but the Postgres store is not implemented yet. " +
        "Unset DATABASE_URL to run on the local JSON store, or implement " +
        "PostgresStore against the Store interface in src/lib/store/types.ts.",
    );
  }

  cached = new LocalStore();
  return cached;
}

export const isLocalStore = () => !process.env.DATABASE_URL;
