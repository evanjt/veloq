/** Translation keys for the phases reported by detection and cutover runs. */
export const PHASE_DISPLAY_KEYS = {
  loading: 'phaseNames.loading',
  analyzing: 'phaseNames.analysing',
  saving: 'phaseNames.saving',
  recomputing_indicators: 'phaseNames.recomputingIndicators',
  diffing: 'phaseNames.diffing',
  complete: 'phaseNames.complete',
  cancelled: 'phaseNames.cancelled',
  draining: 'phaseNames.draining',
  archiving: 'phaseNames.archiving',
  detecting: 'phaseNames.detecting',
} as const;

export function getPhaseDisplayKey(
  phase: string
): (typeof PHASE_DISPLAY_KEYS)[keyof typeof PHASE_DISPLAY_KEYS] | null {
  return PHASE_DISPLAY_KEYS[phase as keyof typeof PHASE_DISPLAY_KEYS] ?? null;
}
