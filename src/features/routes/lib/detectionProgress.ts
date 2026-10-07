/**
 * Human-readable display names for Rust section detection phases.
 * Used by the rescan progress display in SyncRangePanel.
 */

const PHASE_DISPLAY_NAMES: Record<string, string> = {
  loading: 'Loading tracks',
  analyzing: 'Analyzing activities',
  saving: 'Saving sections',
  recomputing_indicators: 'Computing indicators',
  diffing: 'Comparing catalogues',
  complete: 'Complete',
};

export function getPhaseDisplayName(phase: string): string {
  return PHASE_DISPLAY_NAMES[phase] ?? phase;
}
