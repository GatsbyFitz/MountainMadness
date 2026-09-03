import { LocalStore } from "./local";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

export * from "./types";

let cached: Store | null = null;

/**
 * Picks the storage backend.
 *
 * DATABASE_URL selects Postgres/PostGIS; without it the local JSON store runs,
 * which is what makes `npm run dev` work on a fresh clone. There is deliberately
 * no silent fallback in the other direction: a configured database that cannot
 * be reached is an error worth seeing, not a reason to start writing production
 * uploads to a file on an ephemeral serverless disk.
 */
export function getStore(): Store {
  if (cached) return cached;
  cached = process.env.DATABASE_URL
    ? new PostgresStore(process.env.DATABASE_URL)
    : new LocalStore();
  return cached;
}

export const isLocalStore = () => !process.env.DATABASE_URL;
