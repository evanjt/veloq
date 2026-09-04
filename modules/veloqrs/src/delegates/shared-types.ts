/**
 * Shared types used by delegate modules and re-exported from EngineClient
 * for public consumption (via `export { type Foo } from '...'`).
 *
 * Every shape here now exists in `./generated/veloqrs.ts`, so this module is a
 * naming layer over the generated records rather than a second declaration of
 * them. Two names differ from the generated ones for backward compatibility
 * with existing consumers.
 */

export type {
  FfiActivityIndicator,
  FfiActivityRouteHighlight,
  FfiActivitySectionHighlight,
  FfiMergeCandidate,
  FfiNearbySectionSummary,
  FfiSectionMatch,
} from '../generated/veloqrs';

/** Pre-computed daily activity intensity from Rust heatmap cache. */
export type { FfiHeatmapDay as HeatmapDay } from '../generated/veloqrs';

/** A section encounter: one (section, direction) pair for a given activity. */
export type { FfiSectionEncounter as SectionEncounter } from '../generated/veloqrs';
