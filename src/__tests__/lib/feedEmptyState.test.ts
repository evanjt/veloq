/**
 * Scenario: a first launch on a fresh install. Nothing is stored, the engine is
 * partway through its first sync, and the feed renders whatever has landed at
 * the moment it reads.
 *
 * Expected behaviour: while the library is empty and a first sync is running,
 * the feed says so and stands by, rather than showing "No activities" over a
 * summary card full of zeros. Every other empty case reads as it did.
 */

import { SyncErrorReason, SyncState } from 'veloqrs';

import { feedEmptyState } from '@/features/home/lib/feedEmptyState';

const base = {
  storedCount: 0,
  syncState: SyncState.Idle as SyncState | undefined,
  lastErrorReason: null as SyncErrorReason | null,
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

/**
 * Scenario: the first sync did not fill the library. It was cancelled partway,
 * intervals.icu refused the login or asked for a pause, or it never reached the
 * server at all.
 *
 * Expected behaviour: the feed names the cause instead of saying the athlete
 * has no activities, because their activities are on intervals.icu and only
 * the sync failed to bring them.
 */
describe('why an empty library is empty', () => {
  it('says the sync is paused while the engine holds it', () => {
    expect(feedEmptyState({ ...base, syncState: SyncState.Paused })).toBe('paused');
  });

  it('says the sync is paused when intervals.icu asked it to wait', () => {
    expect(feedEmptyState({ ...base, lastErrorReason: SyncErrorReason.RateLimited })).toBe(
      'paused'
    );
  });

  it('asks for a sign in when the engine has parked on a refused credential', () => {
    expect(feedEmptyState({ ...base, syncState: SyncState.AuthExpired })).toBe('authExpired');
  });

  it('asks for a sign in when the last sync was refused for its login', () => {
    expect(feedEmptyState({ ...base, lastErrorReason: SyncErrorReason.Unauthorized })).toBe(
      'authExpired'
    );
  });

  it('says the sync failed when it settled with an error and stored nothing', () => {
    expect(feedEmptyState({ ...base, lastErrorReason: SyncErrorReason.Server })).toBe('failed');
  });

  it('says the sync failed when it never reached intervals.icu', () => {
    expect(feedEmptyState({ ...base, lastErrorReason: SyncErrorReason.Network })).toBe('failed');
  });

  it('stands by over a stale error once a new sync is running', () => {
    expect(
      feedEmptyState({
        ...base,
        syncState: SyncState.Syncing,
        lastErrorReason: SyncErrorReason.Network,
      })
    ).toBe('standby');
  });

  it('keeps the skeletons over a stale error while the read has not answered', () => {
    // The library may hold rows the read has not returned yet, and naming a
    // failure over them would flash a cause that is not true.
    expect(
      feedEmptyState({ ...base, isLoading: true, lastErrorReason: SyncErrorReason.Network })
    ).toBe('skeletons');
  });

  it('shows the cards whatever the last sync said', () => {
    expect(
      feedEmptyState({
        ...base,
        storedCount: 12,
        syncState: SyncState.AuthExpired,
        lastErrorReason: SyncErrorReason.Unauthorized,
      })
    ).toBe('none');
  });

  it("leaves a filter that matched nothing as the athlete's own empty result", () => {
    expect(
      feedEmptyState({
        ...base,
        hasFilter: true,
        syncState: SyncState.Paused,
        lastErrorReason: SyncErrorReason.Network,
      })
    ).toBe('empty');
  });
});
