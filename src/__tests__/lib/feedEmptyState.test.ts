/**
 * Scenario: a first launch on a fresh install. Nothing is stored, the engine is
 * partway through its first sync, and the feed renders whatever has landed at
 * the moment it reads.
 *
 * Expected behaviour: while the library is empty and a first sync is running,
 * the feed says so and stands by, rather than showing "No activities" over a
 * summary card full of zeros. Every other empty case reads as it did.
 */

import { SyncState } from 'veloqrs';

import { feedEmptyState } from '@/features/home/lib/feedEmptyState';

const base = {
  storedCount: 0,
  syncState: SyncState.Idle as SyncState | undefined,
  isError: false,
  isLoading: false,
  hasFilter: false,
};

describe('what an empty feed shows', () => {
  it('stands by while a first sync is filling an empty library', () => {
    expect(feedEmptyState({ ...base, syncState: SyncState.Syncing })).toBe('standby');
  });

  it('stands by even after the first query has resolved empty', () => {
    // `isLoading` is false by then, which is why the screen said "No
    // activities" while the sync was still running.
    expect(feedEmptyState({ ...base, syncState: SyncState.Syncing, isLoading: false })).toBe(
      'standby'
    );
  });

  it('stops standing by the moment the first cards land', () => {
    expect(feedEmptyState({ ...base, storedCount: 3, syncState: SyncState.Syncing })).toBe('none');
  });

  it('does not stand by for a later sync over a library that already has cards', () => {
    expect(feedEmptyState({ ...base, storedCount: 400, syncState: SyncState.Syncing })).toBe(
      'none'
    );
  });

  it('does not stand by when the athlete has filtered the feed to nothing', () => {
    // Their own filter, not a missing library: saying a sync is running would
    // be answering a question they did not ask.
    expect(
      // Filtered to nothing, so the count the feed holds is zero: `hasFilter`
      // is what says the zero is theirs and not the library's.
      feedEmptyState({ ...base, storedCount: 0, hasFilter: true, syncState: SyncState.Syncing })
    ).toBe('empty');
  });

  it('shows the error over everything, because a retry is what is owed', () => {
    expect(feedEmptyState({ ...base, isError: true, syncState: SyncState.Syncing })).toBe('error');
  });

  it('keeps the skeletons for a read that has not answered yet, with no sync running', () => {
    expect(feedEmptyState({ ...base, isLoading: true })).toBe('skeletons');
  });

  it('says the library is empty when nothing is syncing and nothing is stored', () => {
    expect(feedEmptyState(base)).toBe('empty');
  });

  it('says the library is empty when the sync settled and brought nothing', () => {
    expect(feedEmptyState({ ...base, syncState: SyncState.Idle })).toBe('empty');
  });

  it('treats an unknown sync state as no sync, rather than standing by for ever', () => {
    expect(feedEmptyState({ ...base, syncState: undefined })).toBe('empty');
  });
});
