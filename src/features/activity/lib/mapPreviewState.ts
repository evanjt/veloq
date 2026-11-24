/**
 * What an activity card's map preview draws, as a function of what is known.
 *
 * The cloud mark means "the server says this ride has a track and the device
 * has none", which is true of every card during a first sync and reads as
 * broken. While the sync is still running the track is owed rather than
 * missing, so the card waits.
 */
import { SyncState, TrackStep, type SyncStatus } from 'veloqrs';

export type MapPreviewState = 'noGps' | 'loading' | 'awaitingDownload' | 'track';

interface MapPreviewInputs {
  /** The server's stream types include latlng. */
  hasGpsData: boolean;
  /** The stream read has not answered yet. */
  isLoading: boolean;
  /** The device holds coordinates to draw. */
  hasTrack: boolean;
  /** The sync service is running, so an absent track may still arrive. */
  isSyncing: boolean;
}

export function mapPreviewState({
  hasGpsData,
  isLoading,
  hasTrack,
  isSyncing,
}: MapPreviewInputs): MapPreviewState {
  if (!hasGpsData) return 'noGps';
  if (isLoading) return 'loading';
  if (hasTrack) return 'track';
  return isSyncing ? 'loading' : 'awaitingDownload';
}

/**
 * Whether a track the device lacks may still arrive. A running sync can bring
 * it, and so can the GPS pass the engine runs on its own after the sync has
 * settled. A held pass is waiting on a budget or a cooldown, so it owes
 * nothing yet and the card says the download is waiting.
 */
export function tracksOwed(
  syncState: SyncStatus['state'] | null,
  trackStep: TrackStep | null
): boolean {
  return syncState === SyncState.Syncing || trackStep === TrackStep.Downloading;
}
