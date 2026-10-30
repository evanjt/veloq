/**
 * Scenario: the athlete opens the sync settings while the backfill has drawn
 * part of its daily allowance.
 *
 * Expected behaviour: the panel says the limit is shared and shows today's
 * figure with the reset time, both from the engine, and says nothing about a
 * limit where the engine reports none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

let mockLimit: { used: number; perDay: number; resetsAtMs: number } | null = null;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/maps', () => ({ TimelineSlider: () => null }));
jest.mock('@/features/activity/hooks', () => ({
  useActivityBoundsCache: () => ({
    cacheStats: { totalActivities: 120, oldestDate: null, newestDate: null },
    syncDateRange: jest.fn(),
  }),
}));
jest.mock('@/shared/app/useOldestActivityDate', () => ({
  useOldestActivityDate: () => ({ data: new Date('2015-01-01T00:00:00') }),
}));
jest.mock('@/features/settings/hooks/useActivityYearCounts', () => ({
  useActivityYearCounts: () => ({ data: [] }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: unknown) => unknown) =>
    selector({
      oldest: '2026-06-03',
      extendedFetch: { phase: 'idle', since: 0 },
      isExpansionLocked: false,
    }),
}));
jest.mock('@/shared/native/useSyncStatus', () => ({ useTrackStage: () => null }));
jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => ({
    upstream: 600,
    fetched: 600,
    tracksUpstream: 600,
    tracksStored: 139,
  }),
}));
jest.mock('@/features/settings/hooks/useBackgroundJobs', () => ({
  useDailyLimit: () => mockLimit,
}));

describe('the sync range panel daily limit', () => {
  beforeEach(() => {
    mockLimit = null;
  });

  it('shows the shared limit, today’s figure and the reset while downloads are owed', async () => {
    mockLimit = { used: 120, perDay: 650, resetsAtMs: Date.UTC(2026, 9, 31, 1, 0) };
    const view = await render(<SyncRangePanel />);

    expect(view.getByText('settings.dailyLimitShared')).toBeTruthy();
    expect(view.getByText('settings.dailyLimitToday:{"used":120,"limit":650}')).toBeTruthy();
    expect(view.getByText(/^settings\.dailyLimitResets:/)).toBeTruthy();
  });

  it('counts the bar in activities', async () => {
    const view = await render(<SyncRangePanel />);

    expect(
      view.getByText(/settings\.rangeActivitiesDownloaded:{"completed":139,"total":600}/)
    ).toBeTruthy();
  });

  it('prints no limit lines where the engine reports none', async () => {
    const view = await render(<SyncRangePanel />);

    expect(view.queryByText('settings.dailyLimitShared')).toBeNull();
  });
});
