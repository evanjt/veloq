/**
 * Scenario: a first launch syncs the whole library, so for minutes every card
 * has a ride the server says carries GPS and a device that holds none of it.
 *
 * Expected behaviour: the card waits while the sync is running, and shows the
 * download mark only once a settled sync has left the track behind.
 */
import { mapPreviewState } from '../mapPreviewState';

const inputs = {
  hasGpsData: true,
  isLoading: false,
  hasTrack: false,
  isSyncing: false,
};

describe('the activity card map preview state', () => {
  it('waits while a sync could still deliver the track', () => {
    expect(mapPreviewState({ ...inputs, isSyncing: true })).toBe('loading');
  });

  it('asks for the download once the sync has settled without it', () => {
    expect(mapPreviewState(inputs)).toBe('awaitingDownload');
  });

  it('draws the track it has, sync or no sync', () => {
    expect(mapPreviewState({ ...inputs, hasTrack: true, isSyncing: true })).toBe('track');
    expect(mapPreviewState({ ...inputs, hasTrack: true })).toBe('track');
  });

  it('says a ride without GPS has none, even mid-sync', () => {
    expect(mapPreviewState({ ...inputs, hasGpsData: false, isSyncing: true })).toBe('noGps');
  });

  it("keeps the stream read's own loading state", () => {
    expect(mapPreviewState({ ...inputs, isLoading: true })).toBe('loading');
  });
});
