/**
 * Thrown when a write could not be persisted.
 *
 * Raised by both storage paths — the metadata store and raw blob storage —
 * because a failure in either means the upload was not saved, and the caller
 * must never be told otherwise.
 */
export class ReadOnlyStoreError extends Error {
  constructor(cause?: unknown) {
    super(
      "This deployment has no writable storage, so uploads cannot be saved. " +
        "Vercel's filesystem is read-only apart from a per-invocation /tmp. " +
        "Set BLOB_READ_WRITE_TOKEN and DATABASE_URL (and implement " +
        "PostgresStore) to accept uploads in production.",
      { cause },
    );
    this.name = "ReadOnlyStoreError";
  }
}
