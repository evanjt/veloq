/**
 * The status a GPS download run ends on when it stores nothing.
 *
 * Every exit writes one. A run whose store thread dies returns no result, and
 * returning in silence leaves the run's last `fetching` standing, which the
 * expansion lock reads as a sync that never settles.
 *
 * A run the athlete cancelled, or one a newer sync took over, is not a
 * failure, so it goes back to idle rather than raising an error a screen would
 * then have to explain. A run that no longer owns the progress, because the
 * screen is gone or a sync reset aborted it, writes nothing at all: the
 * progress belongs to the run that replaced it. The message is diagnostic and
 * not translated: what the screens show of the download is the engine's track
 * stage, so it reaches the log and no athlete.
 */
import { StartOutcome } from 'veloqrs';
import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';

/** Why a run ended without storing what it was asked for. */
export type GpsSyncEnding =
  | 'no-result'
  | 'no-engine'
  | 'cancelled'
  | 'superseded'
  | 'owed'
  | 'not-started';

interface Ending {
  status: SyncProgress['status'];
  message: string;
}

const ENDINGS: Record<GpsSyncEnding, Ending> = {
  'no-result': { status: 'error', message: 'Download returned no result' },
  'no-engine': { status: 'error', message: 'Engine not available' },
  cancelled: { status: 'idle', message: 'Cancelled' },
  superseded: { status: 'idle', message: 'Sync reset - results discarded' },
  owed: { status: 'idle', message: 'Pass owed, the engine starts it' },
  'not-started': { status: 'idle', message: 'Pass not started' },
};

/**
 * The ending for a pass the engine did not start. One running, or the network
 * gone, leaves it owed in the engine, which starts it without being asked
 * again. Every other refusal has nothing for this run to do.
 */
export function passRefusalEnding(outcome: StartOutcome): GpsSyncEnding {
  return outcome === StartOutcome.Busy || outcome === StartOutcome.Offline ? 'owed' : 'not-started';
}

export interface GpsSyncEndingContext {
  /** Writes the progress the three surfaces read. */
  updateProgress: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void;
  /**
   * Whether the run still owns the progress: the screen is still mounted and
   * no newer sync aborted it. A run that lost it writes nothing, so its ending
   * cannot overwrite the sync that replaced it.
   */
  owns: boolean;
  /** How many activities the run was asked for. */
  withGpsCount: number;
}

/**
 * Write the terminal status and give back the run's result. One call, so an
 * exit cannot write the result and forget the status.
 */
export function endGpsSync(
  ending: GpsSyncEnding,
  { updateProgress, owns, withGpsCount }: GpsSyncEndingContext
): { syncedIds: string[]; withGpsCount: number; message: string } {
  const { status, message } = ENDINGS[ending];

  if (owns) {
    updateProgress({ status, completed: 0, total: 0, percent: 0, message });
  }

  return {
    syncedIds: [],
    // A superseded run's activities belong to the sync that took over, so
    // counting them here would double what the next result reports.
    withGpsCount: ending === 'superseded' ? 0 : withGpsCount,
    message,
  };
}
