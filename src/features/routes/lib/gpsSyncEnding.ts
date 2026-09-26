/**
 * The status a GPS download run ends on when it stores nothing.
 *
 * Every exit writes one. A run whose store thread dies returns no result, and
 * returning in silence leaves the last `fetching` standing on the map banner,
 * the settings range panel and the routes list spinner until the next sync
 * replaces it, which is the next foreground or reconnect at the earliest.
 *
 * A run the athlete cancelled, or one a newer sync took over, is not a
 * failure, so it goes back to idle rather than raising an error a screen would
 * then have to explain. The message is diagnostic and not translated:
 * `formatGpsSyncProgress` renders nothing for either terminal status, so it
 * reaches the log and the debug panel and no athlete.
 */
import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';

/** Why a run ended without storing what it was asked for. */
export type GpsSyncEnding = 'no-result' | 'no-engine' | 'cancelled' | 'superseded';

interface Ending {
  status: SyncProgress['status'];
  message: string;
}

const ENDINGS: Record<GpsSyncEnding, Ending> = {
  'no-result': { status: 'error', message: 'Download returned no result' },
  'no-engine': { status: 'error', message: 'Engine not available' },
  cancelled: { status: 'idle', message: 'Cancelled' },
  superseded: { status: 'idle', message: 'Sync reset - results discarded' },
};

export interface GpsSyncEndingContext {
  /** Writes the progress the three surfaces read. */
  updateProgress: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void;
  /** Whether the screen is still there to be written to. */
  isMounted: boolean;
  /** How many activities the run was asked for. */
  withGpsCount: number;
}

/**
 * Write the terminal status and give back the run's result. One call, so an
 * exit cannot write the result and forget the status.
 */
export function endGpsSync(
  ending: GpsSyncEnding,
  { updateProgress, isMounted, withGpsCount }: GpsSyncEndingContext
): { syncedIds: string[]; withGpsCount: number; message: string } {
  const { status, message } = ENDINGS[ending];

  if (isMounted) {
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
