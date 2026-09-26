/**
 * Scenario: every progress figure the app shows is the running pass's own
 * queue. A library of 1,598 rides with 400 tracks stored reports "12/12" and
 * then nothing, so the 1,186 no pass has queued are invisible and a route short
 * of a track reads as complete.
 *
 * Expected behaviour: the sync row reports the whole account. One line per pair
 * that is short, nothing at all when both agree, and nothing when the census
 * has never been pulled and no figure would be honest.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { LibraryCoverage } from 'veloqrs';

import { ActivitySyncRow } from '@/features/settings/components/ActivitySyncRow';
import { formatLibraryCoverage } from '@/shared/format/libraryCoverage';
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => ({
    state: require('../__shared__/veloqrsStub').SyncState.Syncing,
    completed: 4,
    total: 7,
    step: require('../__shared__/veloqrsStub').SyncStep.Activities,
  }),
}));

let mockCoverage: LibraryCoverage | null = null;
jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => mockCoverage,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ cancelSync: jest.fn() }),
}));

/** `t` answers with the key and its variables, so the numbers are assertable. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key) as never;

function coverage(partial: Partial<LibraryCoverage>): LibraryCoverage {
  return { upstream: 0, fetched: 0, tracksUpstream: 0, tracksStored: 0, ...partial };
}

beforeEach(() => {
  mockCoverage = null;
});

describe('the library coverage lines', () => {
  it('names both pairs when both are short', () => {
    const lines = formatLibraryCoverage(
      coverage({ upstream: 1598, fetched: 412, tracksUpstream: 1400, tracksStored: 400 }),
      t
    );

    expect(lines).toEqual([
      'sync.ridesDownloaded:{"completed":412,"total":1598}',
      'sync.tracksDownloaded:{"completed":400,"total":1400}',
    ]);
  });

  it('names only the pair that is short', () => {
    const lines = formatLibraryCoverage(
      coverage({ upstream: 100, fetched: 100, tracksUpstream: 80, tracksStored: 12 }),
      t
    );

    expect(lines).toEqual(['sync.tracksDownloaded:{"completed":12,"total":80}']);
  });

  it('says nothing when both pairs agree', () => {
    expect(
      formatLibraryCoverage(
        coverage({ upstream: 100, fetched: 100, tracksUpstream: 80, tracksStored: 80 }),
        t
      )
    ).toEqual([]);
  });

  /** Zeros are an account nobody has read, and a fraction there is a claim. */
  it('says nothing for a census that has never been pulled', () => {
    expect(formatLibraryCoverage(coverage({}), t)).toEqual([]);
    expect(formatLibraryCoverage(null, t)).toEqual([]);
  });

  /** An account with no GPS at all is not a track pair that is short. */
  it('says nothing about tracks when the account has none upstream', () => {
    const lines = formatLibraryCoverage(
      coverage({ upstream: 10, fetched: 10, tracksUpstream: 0, tracksStored: 0 }),
      t
    );

    expect(lines).toEqual([]);
  });
});

describe('the running sync row', () => {
  it('carries the library lines beside its own queue figure', () => {
    mockCoverage = coverage({
      upstream: 1598,
      fetched: 412,
      tracksUpstream: 1400,
      tracksStored: 400,
    });

    render(<ActivitySyncRow />);

    expect(screen.getByTestId('sync-library-coverage')).toBeTruthy();
    expect(screen.getByText('sync.ridesDownloaded:{"completed":412,"total":1598}')).toBeTruthy();
    expect(
      screen.getByText(
        'settings.syncStepProgress:{"label":"settings.syncStep.activities","completed":4,"total":7}'
      )
    ).toBeTruthy();
  });

  it('carries no library line when the library is fully downloaded', () => {
    mockCoverage = coverage({
      upstream: 100,
      fetched: 100,
      tracksUpstream: 80,
      tracksStored: 80,
    });

    render(<ActivitySyncRow />);

    expect(screen.queryByTestId('sync-library-coverage')).toBeNull();
  });
});
