/**
 * Human-readable display names for Rust section detection phases.
 * Used by the rescan progress display in SyncRangePanel.
 */

const PHASE_DISPLAY_NAMES: Record<string, string> = {
  loading: 'Loading tracks',
  building_rtrees: 'Building spatial index',
  finding_overlaps: 'Finding overlaps',
  clustering: 'Clustering sections',
  postprocessing: 'Processing sections',
  saving: 'Saving sections',
  merging_cross_sport: 'Merging sections',
  recomputing_indicators: 'Computing indicators',
  complete: 'Complete',
};

export function getPhaseDisplayName(phase: string): string {
  return PHASE_DISPLAY_NAMES[phase] ?? phase;
}
