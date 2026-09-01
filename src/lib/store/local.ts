import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Peak, Route, Store, Track, Trip, User, Visibility } from "./types";

/**
 * A JSON-file store, so the app runs with zero cloud credentials.
 *
 * This is not a database and does not pretend to be one: no concurrency
 * control, no indexes, whole-file rewrites. It exists so `npm run dev` works
 * on a fresh clone and so the ingest pipeline and viewer can be exercised
 * end-to-end before Neon is provisioned.
 */

interface Db {
  users: User[];
  peaks: Peak[];
  routes: Route[];
  trips: Trip[];
  tracks: Track[];
}

const EMPTY: Db = { users: [], peaks: [], routes: [], trips: [], tracks: [] };

const DATA_DIR = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "db.json");

/**
 * Serialises writes. Next.js runs route handlers concurrently, and two
 * read-modify-write cycles racing on one file silently lose an upload.
 */
let writeChain: Promise<unknown> = Promise.resolve();

async function readDb(): Promise<Db> {
  try {
    const raw = await readFile(DB_PATH, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Db>) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

async function mutate<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
    return result;
  });
  // Keep the chain alive even if this link rejects.
  writeChain = run.catch(() => undefined);
  return run;
}

export class LocalStore implements Store {
  async listPeaks(): Promise<Peak[]> {
    const db = await readDb();
    return db.peaks
      .slice()
      .sort((a, b) => (b.elevationM ?? 0) - (a.elevationM ?? 0));
  }

  async getPeak(id: string): Promise<Peak | null> {
    const db = await readDb();
    return db.peaks.find((p) => p.id === id) ?? null;
  }

  async getPeakBySlug(slug: string): Promise<Peak | null> {
    const db = await readDb();
    return db.peaks.find((p) => p.slug === slug) ?? null;
  }

  async listRoutesForPeak(peakId: string): Promise<Route[]> {
    const db = await readDb();
    return db.routes.filter((r) => r.peakId === peakId);
  }

  async getRoute(id: string): Promise<Route | null> {
    const db = await readDb();
    return db.routes.find((r) => r.id === id) ?? null;
  }

  async listTrips(opts: { visibility?: Visibility; peakId?: string } = {}): Promise<Trip[]> {
    const db = await readDb();
    return db.trips
      .filter((t) => (opts.visibility ? t.visibility === opts.visibility : true))
      .filter((t) => (opts.peakId ? t.peakId === opts.peakId : true))
      .sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
  }

  async getTrip(id: string): Promise<Trip | null> {
    const db = await readDb();
    return db.trips.find((t) => t.id === id) ?? null;
  }

  async createTrip(trip: Omit<Trip, "id" | "createdAt">): Promise<Trip> {
    return mutate((db) => {
      const created: Trip = { ...trip, id: randomUUID(), createdAt: new Date().toISOString() };
      db.trips.push(created);
      return created;
    });
  }

  async updateTrip(id: string, patch: Partial<Trip>): Promise<Trip | null> {
    return mutate((db) => {
      const i = db.trips.findIndex((t) => t.id === id);
      if (i === -1) return null;
      // id and createdAt are not patchable.
      const { id: _id, createdAt: _c, ...rest } = patch;
      db.trips[i] = { ...db.trips[i], ...rest };
      return db.trips[i];
    });
  }

  async getTrackByTrip(tripId: string): Promise<Track | null> {
    const db = await readDb();
    return db.tracks.find((t) => t.tripId === tripId) ?? null;
  }

  async saveTrack(track: Omit<Track, "id">): Promise<Track> {
    return mutate((db) => {
      const created: Track = { ...track, id: randomUUID() };
      // One track per trip for now; a later multi-day trip may relax this.
      const existing = db.tracks.findIndex((t) => t.tripId === track.tripId);
      if (existing === -1) db.tracks.push(created);
      else db.tracks[existing] = created;
      return created;
    });
  }

  async getUser(id: string): Promise<User | null> {
    const db = await readDb();
    return db.users.find((u) => u.id === id) ?? null;
  }

  async getUserByHandle(handle: string): Promise<User | null> {
    const db = await readDb();
    return db.users.find((u) => u.handle === handle) ?? null;
  }

  /** Used by the seed script; not part of the Store interface. */
  async replaceAll(db: Partial<Db>): Promise<void> {
    await mutate((current) => {
      Object.assign(current, EMPTY, db);
    });
  }
}
