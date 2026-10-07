/**
 * Scenario: a sync settles while detection is still running in Rust, so the
 * progress write is 'complete' with the still-analysing message.
 *
 * Expected behaviour: the sync settles (timestamp stamped) but the surfaces
 * where it started keep showing that the analysis is running, until the run
 * announces its end.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { formatGpsSyncProgress } from '@/features/maps/lib/syncProgressFormat';
import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/maps', () => ({ TimelineSlider: () => null }));
jest.mock('@/features/activity', () => ({
  useActivityBoundsCache: () => ({
    cacheStats: { oldestDate: null, totalActivities: 0 },
    syncDateRange: jest.fn(),
  }),
}));
jest.mock('@/shared/app/useOldestActivityDate', () => ({
  useOldestActivityDate: () => ({ data: null }),
}));
jest.mock('@/shared/app/useActivityYearCounts', () => ({
  useActivityYearCounts: () => ({ data: [] }),
}));

const t = ((key: string) => key) as never;

const stillAnalysing = {
  status: 'complete' as const,
  completed: 2,
  total: 2,
  percent: 100,
  message: 'Synced 2 activities. Still analysing routes',
  analysingInBackground: true,
};

const settled = { ...stillAnalysing, analysingInBackground: false, message: 'Synced' };

beforeEach(() => {
  act(() => useSyncDateRange.getState().setGpsSyncProgress(settled));
});

describe('the store', () => {
  it('settles the sync but holds the analysing state live', () => {
    act(() => useSyncDateRange.getState().setGpsSyncProgress(stillAnalysing));
    const s = useSyncDateRange.getState();

    expect(s.lastSyncTimestamp).not.toBeNull();
    expect(s.isAnalysingInBackground).toBe(true);
  });

  it('drops it when the run announces its end', () => {
    act(() => useSyncDateRange.getState().setGpsSyncProgress(stillAnalysing));
    act(() => useSyncDateRange.getState().backgroundAnalysisEnded());

    expect(useSyncDateRange.getState().isAnalysingInBackground).toBe(false);
  });

  it('drops it when a new sync starts', () => {
    act(() => useSyncDateRange.getState().setGpsSyncProgress(stillAnalysing));
    act(() =>
      useSyncDateRange
        .getState()
        .setGpsSyncProgress({ ...settled, status: 'fetching', percent: 0, message: '' })
    );

    expect(useSyncDateRange.getState().isAnalysingInBackground).toBe(false);
  });

  it('is not raised by an ordinary completion', () => {
    expect(useSyncDateRange.getState().isAnalysingInBackground).toBe(false);
  });
});

describe('formatGpsSyncProgress', () => {
  it('renders the still-analysing message as live', () => {
    const info = formatGpsSyncProgress(stillAnalysing, false, t);

    expect(info?.text).toBe(stillAnalysing.message);
    expect(info?.indeterminate).toBe(true);
  });

  it('renders nothing for an ordinary completion', () => {
    expect(formatGpsSyncProgress(settled, false, t)).toBeNull();
  });
});

describe('SyncRangePanel', () => {
  it('shows the still-analysing message until the run ends', () => {
    const { queryByText } = render(<SyncRangePanel />);
    expect(queryByText(/Still analysing routes/)).toBeNull();

    act(() => useSyncDateRange.getState().setGpsSyncProgress(stillAnalysing));
    expect(queryByText(/Still analysing routes/)).not.toBeNull();

    act(() => useSyncDateRange.getState().backgroundAnalysisEnded());
    expect(queryByText(/Still analysing routes/)).toBeNull();
  });
});
