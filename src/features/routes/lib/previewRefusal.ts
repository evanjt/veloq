import { StartOutcome, startOutcome, type StartVerdict } from 'veloqrs';

/**
 * The line a refused preview start shows, or none when it started or the
 * refusal has a state of its own.
 *
 * `Held` is the elevation backfill's suspension or a component backing off
 * after a failed run, and only the first is elevation work: the caller says
 * which through `elevationHold`. `NotConfigured` is the run's error state.
 */
export type PreviewRefusalKey =
  | 'settings.previewRefusedBusy'
  | 'settings.previewSuspended'
  | 'settings.previewRefusedRecentFailure'
  | 'sections.rescanRefusedNotReady'
  | 'settings.previewRefusedNothingCovers'
  | 'settings.previewRefusedFailed';

export function previewRefusalKey(
  outcome: StartVerdict | null,
  elevationHold: boolean
): PreviewRefusalKey | null {
  switch (outcome === null ? null : startOutcome(outcome)) {
    case StartOutcome.Busy:
      return 'settings.previewRefusedBusy';
    case StartOutcome.Held:
      return elevationHold ? 'settings.previewSuspended' : 'settings.previewRefusedRecentFailure';
    case StartOutcome.NotReady:
      return 'sections.rescanRefusedNotReady';
    case StartOutcome.NotOwed:
      return 'settings.previewRefusedNothingCovers';
    case StartOutcome.Failed:
      return 'settings.previewRefusedFailed';
    default:
      return null;
  }
}
