/**
 * What an activity card's map preview draws, as a function of what is known.
 *
 * The cloud mark means "the server says this ride has a track and the device
 * has none", which is true of every card during a first sync and reads as
 * broken. While the sync is still running the track is owed rather than
 * missing, so the card waits.
 */
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
