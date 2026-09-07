import { StartOutcome } from 'veloqrs';

/**
 * The line a refused rescan shows, or none when the run started.
 *
 * Rust answers every start with a verdict and the screens dropped it, so a
 * library with route matching switched off, one waiting out an elevation pass
 * and one whose engine is not open yet all showed the same nothing. The
 * mapping lives here so the two screens that ask cannot disagree about what a
 * verdict means.
 */
export type RescanRefusalKey =
  | 'sections.rescanRefusedBusy'
  | 'sections.rescanRefusedHeld'
  | 'sections.rescanRefusedNotReady'
  | 'sections.rescanRefusedOff'
  | 'sections.rescanRefusedNothingOwed'
  | 'sections.rescanRefusedFailed';

export function rescanRefusalKey(outcome: StartOutcome | null): RescanRefusalKey | null {
  switch (outcome) {
    case StartOutcome.Busy:
      return 'sections.rescanRefusedBusy';
    case StartOutcome.Held:
      return 'sections.rescanRefusedHeld';
    case StartOutcome.NotReady:
      return 'sections.rescanRefusedNotReady';
    case StartOutcome.NotConfigured:
      return 'sections.rescanRefusedOff';
    case StartOutcome.NotOwed:
      return 'sections.rescanRefusedNothingOwed';
    case StartOutcome.Failed:
      return 'sections.rescanRefusedFailed';
    default:
      return null;
  }
}
