import { StartOutcome } from 'veloqrs';

/**
 * The line a refused stream backfill start shows, or none when it started.
 *
 * Nothing in the engine waits for the connection or retries this pass, so a
 * refusal is the athlete's cue to try again, and each verdict says why.
 */
export type StreamBackfillRefusalKey =
  | 'settings.streamBackfillRefusedOffline'
  | 'settings.streamBackfillRefusedNotConfigured'
  | 'settings.streamBackfillRefusedNotReady'
  | 'settings.streamBackfillRefusedBusy'
  | 'settings.streamBackfillRefusedFailed';

export function streamBackfillRefusalKey(
  outcome: StartOutcome | null
): StreamBackfillRefusalKey | null {
  switch (outcome) {
    case StartOutcome.Offline:
      return 'settings.streamBackfillRefusedOffline';
    case StartOutcome.NotConfigured:
      return 'settings.streamBackfillRefusedNotConfigured';
    case StartOutcome.NotReady:
      return 'settings.streamBackfillRefusedNotReady';
    case StartOutcome.Busy:
      return 'settings.streamBackfillRefusedBusy';
    case StartOutcome.Failed:
      return 'settings.streamBackfillRefusedFailed';
    default:
      return null;
  }
}
