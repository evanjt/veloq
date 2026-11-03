/**
 * Scenario: the history slider can reach the athlete's first-ever activity, so
 * one drag to the left edge could start an unbounded download.
 *
 * Expected behaviour: a drag only proposes a range and states what it costs;
 * nothing downloads until the confirm button is pressed, and a drag back to the
 * synced edge withdraws the proposal.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
const mockSyncDateRange = jest.fn();
let mockSliderRangeChange: ((start: Date, end: Date) => void) | null = null;
let mockResetKeys: (number | undefined)[] = [];
let mockYearCounts: { year: number; count: number }[] = [];
let mockDayShare: number | undefined;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; activities?: number }) => {
      const n = options?.count ?? options?.activities;
      return n === undefined ? key : `${key}:${n}`;
    },
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/features/maps', () => {
  const { View } = require('react-native');
  return {
    TimelineSlider: (props: {
      onRangeChange: (start: Date, end: Date) => void;
      resetKey?: number;
    }) => {
      mockSliderRangeChange = props.onRangeChange;
      mockResetKeys.push(props.resetKey);
      return <View testID="timeline-slider" />;
    },
  };
});

jest.mock('@/features/activity/hooks', () => ({
  useActivityBoundsCache: () => ({
    progress: { status: 'idle' },
    cacheStats: { totalActivities: 120, oldestDate: null, newestDate: null },
    syncDateRange: mockSyncDateRange,
  }),
}));

jest.mock('@/shared/app/useOldestActivityDate', () => ({
  useOldestActivityDate: () => ({ data: new Date('2015-01-01T00:00:00') }),
}));

jest.mock('@/features/settings/hooks/useBackfillDayShare', () => ({
  useBackfillDayShare: () => mockDayShare,
}));

jest.mock('@/features/settings/hooks/useActivityYearCounts', () => ({
  useActivityYearCounts: () => ({ data: mockYearCounts }),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: (selector: (s: unknown) => unknown) =>
    selector({ settings: { heatmapEnabled: false }, setHeatmapEnabled: jest.fn() }),
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: unknown) => unknown) =>
    selector({
      oldest: '2026-06-03',
      extendedFetch: { phase: 'idle', since: 0 },
      isExpansionLocked: false,
    }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

jest.mock('@/features/maps/lib/heatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/tmp/heatmap',
}));

const BIG = [
  { year: 2015, count: 700 },
  { year: 2025, count: 40 },
  { year: 2026, count: 60 },
];
const SMALL = [
  { year: 2025, count: 40 },
  { year: 2026, count: 60 },
];

async function propose(start: string) {
  const view = await render(<SyncRangePanel />);
  await act(() => {
    mockSliderRangeChange?.(new Date(`${start}T00:00:00`), new Date());
  });
  return view;
}

describe('the history sheet slider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSliderRangeChange = null;
    mockResetKeys = [];
    mockYearCounts = [];
    mockDayShare = undefined;
  });

  it('starts nothing while the slider moves, and states the cost', async () => {
    mockYearCounts = SMALL;
    const view = await propose('2025-01-01');

    expect(mockSyncDateRange).not.toHaveBeenCalled();
    expect(view.getByTestId('history-range-cost')).toBeTruthy();
  });

  it('shows no cost line or confirm before the slider moves', async () => {
    const view = await render(<SyncRangePanel />);

    expect(view.queryByTestId('history-range-cost')).toBeNull();
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });

  it('changes the cost line with the proposed range', async () => {
    mockYearCounts = BIG;
    const view = await propose('2025-01-01');
    const small = view.getByTestId('history-range-cost').props.children;
    await act(() => {
      mockSliderRangeChange?.(new Date('2015-01-01T00:00:00'), new Date());
    });

    expect(view.getByTestId('history-range-cost').props.children).not.toEqual(small);
  });

  it('names the days at the daily limit when the range outruns one day', async () => {
    mockYearCounts = BIG;
    mockDayShare = 400;
    const view = await propose('2015-01-01');

    expect(view.getByTestId('history-range-days').props.children).toBe(
      'settings.largeHistoryDaysTitle:2'
    );
    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });

  it('names no days when the range fits inside one day or the engine reports no share', async () => {
    mockYearCounts = SMALL;
    mockDayShare = 400;
    const view = await propose('2025-01-01');

    expect(view.queryByTestId('history-range-days')).toBeNull();
  });

  it('starts the download once on confirm, and never opens an alert for a large range', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncDateRange.mockReturnValue('expanded');
    mockYearCounts = BIG;
    const view = await propose('2015-01-01');

    await fireEvent.press(view.getByTestId('history-range-confirm'));

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
    expect(mockSyncDateRange.mock.calls[0][0]).toBe('2015-01-01');
    expect(alert).not.toHaveBeenCalled();
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });

  it('expands without a count it does not have', async () => {
    mockSyncDateRange.mockReturnValue('expanded');
    mockYearCounts = [];
    const view = await propose('2015-01-01');

    await fireEvent.press(view.getByTestId('history-range-confirm'));

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
  });

  it('withdraws the proposal when the handle is dragged back to the synced edge', async () => {
    mockYearCounts = SMALL;
    const view = await propose('2025-01-01');
    await act(() => {
      mockSliderRangeChange?.(new Date('2026-08-01T00:00:00'), new Date());
    });

    expect(view.queryByTestId('history-range-confirm')).toBeNull();
    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });

  it('says why and puts the handle back when the expansion latch refuses the confirm', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncDateRange.mockReturnValue('locked');
    mockYearCounts = SMALL;
    const view = await propose('2025-01-01');
    const before = new Set(mockResetKeys).size;

    await fireEvent.press(view.getByTestId('history-range-confirm'));

    expect(alert).toHaveBeenCalledWith(
      'settings.rangeLockedTitle',
      'settings.rangeLockedMessage',
      undefined,
      expect.objectContaining({ cancelable: true })
    );
    expect(new Set(mockResetKeys).size).toBe(before + 1);
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });

  it('puts the handle back after a drag that does not widen the range', async () => {
    const view = await render(<SyncRangePanel />);
    const before = new Set(mockResetKeys).size;
    await act(() => {
      mockSliderRangeChange?.(new Date('2026-08-01T00:00:00'), new Date());
    });

    expect(new Set(mockResetKeys).size).toBe(before + 1);
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });
});
