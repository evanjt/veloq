/**
 * Scenario: a first launch syncs the whole library, so for minutes every card
 * has a ride the server says carries GPS and a device that holds none of it.
 *
 * Expected behaviour: the card waits while the sync is running, and shows the
 * download mark only once a settled sync has left the track behind.
 */
import { SyncState, FfiTrackStep } from 'veloqrs';
import { mapPreviewState, tracksOwed } from '../mapPreviewState';

jest.mock('veloqrs', () => require('../../../../__tests__/__shared__/veloqrsStub').withOverrides());

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

describe('whether a track is still owed', () => {
  it('is owed while a sync runs, whatever the stage', () => {
    expect(tracksOwed(SyncState.Syncing, null)).toBe(true);
  });

  it('is owed after the sync settles while the GPS pass downloads', () => {
    expect(tracksOwed(SyncState.Idle, FfiTrackStep.Downloading)).toBe(true);
  });

  it('is not owed when settled with no stage, or a held or later stage', () => {
    expect(tracksOwed(SyncState.Idle, null)).toBe(false);
    expect(tracksOwed(SyncState.Idle, FfiTrackStep.Held)).toBe(false);
    expect(tracksOwed(SyncState.Idle, FfiTrackStep.Analysing)).toBe(false);
  });
});
