import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

/**
 * Re-imports the store with a given data directory.
 *
 * The module resolves LOCAL_DATA_DIR at import time, so the registry has to be
 * reset between cases rather than the env simply re-read.
 */
async function storeWithDataDir(dataDir: string) {
  vi.resetModules();
  vi.stubEnv("LOCAL_DATA_DIR", dataDir);
  return import("./local");
}

const blankTrip = {
  userId: "00000000-0000-4000-8000-000000000001",
  title: "Test trip",
  startedAt: null,
  peakId: null,
  routeIds: [],
  outcome: null,
  highpointM: null,
  notes: null,
  visibility: "private" as const,
};

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const p of cleanup.splice(0)) await rm(p, { recursive: true, force: true });
});

describe("LocalStore", () => {
  it("falls back to the bundled seed when no data directory exists", async () => {
    // The fresh-deploy case. On a read-only host `.data/` never exists, and
    // without this fallback the app serves an empty shell instead of the demo.
    const absent = path.join(tmpdir(), `mm-absent-${Date.now()}`);
    const { LocalStore } = await storeWithDataDir(absent);
    const store = new LocalStore();

    const peaks = await store.listPeaks();
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks[0].name).toBe("Mont Blanc");

    const trips = await store.listTrips();
    expect(trips.length).toBeGreaterThan(0);

    const track = await store.getTrackByTrip(trips[0].id);
    expect(track).not.toBeNull();
    expect(track!.line.length).toBeGreaterThan(100);
  });

  it("round-trips a write when the directory is writable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mm-rw-"));
    cleanup.push(dir);

    const { LocalStore } = await storeWithDataDir(path.join(dir, "data"));
    const store = new LocalStore();

    const created = await store.createTrip(blankTrip);
    expect(await store.getTrip(created.id)).toMatchObject({ title: "Test trip" });
  });

  it("throws rather than reporting success when a write cannot persist", async () => {
    // Silently succeeding on an unpersisted write is the worst outcome: the
    // user is told "uploaded" and the trip is gone by the next request.
    const file = path.join(tmpdir(), `mm-notadir-${Date.now()}`);
    await writeFile(file, "not a directory");
    cleanup.push(file);

    const { LocalStore, ReadOnlyStoreError } = await storeWithDataDir(
      path.join(file, "data"),
    );

    await expect(new LocalStore().createTrip(blankTrip)).rejects.toBeInstanceOf(
      ReadOnlyStoreError,
    );
  });

  it("keeps serving reads after a failed write", async () => {
    // The write chain must not be poisoned by one rejection.
    const file = path.join(tmpdir(), `mm-notadir2-${Date.now()}`);
    await writeFile(file, "not a directory");
    cleanup.push(file);

    const { LocalStore } = await storeWithDataDir(path.join(file, "data"));
    const store = new LocalStore();

    await expect(store.createTrip(blankTrip)).rejects.toThrow();
    expect((await store.listPeaks()).length).toBeGreaterThan(0);
  });
});
