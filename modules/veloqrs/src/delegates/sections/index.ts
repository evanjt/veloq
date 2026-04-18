/**
 * Section delegates.
 *
 * Wraps section CRUD, filtering, polylines, performance queries, exclusion
 * management, name/reference edits, bounds trimming, matching, merge
 * candidates, encounters, and highlight lookups. Every mutation emits a
 * 'sections' notification so consumers re-fetch summaries.
 *
 * This barrel mirrors the `persistence/sections/` Rust split:
 *   - queries.ts    — read-only lookups
 *   - mutations.ts  — CRUD-style changes (create, rename, delete, merge, ...)
 *   - visibility.ts — disable/supersede/exclude toggles and imports
 *   - bounds.ts     — trim/reset/expand section geometry
 */

export * from './queries';
export * from './mutations';
export * from './visibility';
export * from './bounds';
