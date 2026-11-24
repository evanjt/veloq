import { FfiStartOutcome } from 'veloqrs';

/**
 * The line a refused stream backfill start shows, or none when it started.
 *
 * Nothing in the engine waits for the connection or retries this pass, so a
 * refusal is the athlete's cue to try again, and each verdict says why.
 */
type StreamBackfillRefusalKey =
  | 'settings.streamBackfillRefusedOffline'
  | 'settings.streamBackfillRefusedNotConfigured'
  | 'settings.streamBackfillRefusedNotReady'
  | 'settings.streamBackfillRefusedBusy'
  | 'settings.streamBackfillRefusedFailed';

export function streamBackfillRefusalKey(
  outcome: FfiStartOutcome | null
): StreamBackfillRefusalKey | null {
  switch (outcome) {
    case FfiStartOutcome.Offline:
      return 'settings.streamBackfillRefusedOffline';
    case FfiStartOutcome.NotConfigured:
      return 'settings.streamBackfillRefusedNotConfigured';
    case FfiStartOutcome.NotReady:
      return 'settings.streamBackfillRefusedNotReady';
    case FfiStartOutcome.Busy:
      return 'settings.streamBackfillRefusedBusy';
    case FfiStartOutcome.Failed:
      return 'settings.streamBackfillRefusedFailed';
    default:
      return null;
  }
}
