/**
 * Stand-in identity for the single-user local build.
 *
 * Auth.js is Phase 0 in the plan but needs OAuth credentials this build does
 * not have, so every ingest is attributed to one seeded user. Replacing this
 * with the real session lookup is the only change the ingest path needs.
 */
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_USER_HANDLE = "demo";
