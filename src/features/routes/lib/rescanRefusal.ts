import { FfiStartOutcome, startOutcome, type StartVerdict } from 'veloqrs';

/**
 * The line a refused rescan shows, or none when the run started.
 *
 * Rust answers every start with a verdict and the screens dropped it, so a
 * library with route matching switched off, one waiting out an elevation pass
 * and one whose engine is not open yet all showed the same nothing. The
 * mapping lives here so the two screens that ask cannot disagree about what a
 * verdict means.
 */
type RescanRefusalKey =
  | 'sections.rescanRefusedBusy'
  | 'sections.rescanRefusedHeld'
  | 'sections.rescanRefusedNotReady'
  | 'sections.rescanRefusedOff'
  | 'sections.rescanRefusedNothingOwed'
  | 'sections.rescanRefusedFailed';

export function rescanRefusalKey(outcome: StartVerdict | null): RescanRefusalKey | null {
  switch (outcome === null ? null : startOutcome(outcome)) {
    case FfiStartOutcome.Busy:
      return 'sections.rescanRefusedBusy';
    case FfiStartOutcome.Held:
      return 'sections.rescanRefusedHeld';
    case FfiStartOutcome.NotReady:
      return 'sections.rescanRefusedNotReady';
    case FfiStartOutcome.NotConfigured:
      return 'sections.rescanRefusedOff';
    case FfiStartOutcome.NotOwed:
      return 'sections.rescanRefusedNothingOwed';
    case FfiStartOutcome.Failed:
      return 'sections.rescanRefusedFailed';
    default:
      return null;
  }
}
