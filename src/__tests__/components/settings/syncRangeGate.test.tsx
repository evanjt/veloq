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
let mockEstimate: ((from: Date) => { count: number; approximate: boolean } | undefined) | null =
  null;
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

jest.mock('@/features/settings/hooks/useHistoryRangeEstimate', () => ({
  useHistoryRangeEstimate: (from: Date | null) =>
    from && mockEstimate ? mockEstimate(from) : undefined,
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

// The engine's figure: 10 a month from the proposed start to the synced edge in June 2026.
const monthlyEstimate = (from: Date) => {
  const months = (2026 - from.getFullYear()) * 12 + (5 - from.getMonth());
  return { count: months * 10, approximate: false };
};
const BIG = (from: Date) => ({ count: from.getFullYear() <= 2015 ? 700 : 50, approximate: false });
const SMALL = () => ({ count: 50, approximate: false });

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
    mockEstimate = null;
    mockDayShare = undefined;
  });

  it('starts nothing while the slider moves, and states the cost', async () => {
    mockEstimate = SMALL;
    const view = await propose('2025-01-01');

    expect(mockSyncDateRange).not.toHaveBeenCalled();
    expect(view.getByTestId('history-range-cost')).toBeTruthy();
  });

  vaultIt('shows no cost line or confirm before the slider moves', async () => {
    const view = await render(<SyncRangePanel />);

    expect(view.queryByTestId('history-range-cost')).toBeNull();
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });

  vaultIt('changes the cost line with the proposed range', async () => {
    mockEstimate = BIG;
    const view = await propose('2025-01-01');
    const small = view.getByTestId('history-range-cost').props.children;
    await act(() => {
      mockSliderRangeChange?.(new Date('2015-01-01T00:00:00'), new Date());
    });

    expect(view.getByTestId('history-range-cost').props.children).not.toEqual(small);
  });

  it("states the engine's figure for the proposed start, which moves with it", async () => {
    mockEstimate = monthlyEstimate;
    const view = await propose('2026-03-01');
    const text = () => view.getByTestId('history-range-cost').props.children;
    expect(text()).toBe('settings.historyCost:30');
    await act(() => {
      mockSliderRangeChange?.(new Date('2025-12-01T00:00:00'), new Date());
    });
    expect(text()).toBe('settings.historyCost:60');
    await act(() => {
      mockSliderRangeChange?.(new Date('2025-06-01T00:00:00'), new Date());
    });
    expect(text()).toBe('settings.historyCost:120');
  });

  it('names the days at the daily limit when the range outruns one day', async () => {
    mockEstimate = BIG;
    mockDayShare = 400;
    const view = await propose('2015-01-01');

    expect(view.getByTestId('history-range-days').props.children).toBe(
      'settings.largeHistoryDaysTitle:2'
    );
    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });

  it('names no days when the range fits inside one day or the engine reports no share', async () => {
    mockEstimate = SMALL;
    mockDayShare = 400;
    const view = await propose('2025-01-01');

    expect(view.queryByTestId('history-range-days')).toBeNull();
  });

  it('starts the download once on confirm, and never opens an alert for a large range', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncDateRange.mockReturnValue('expanded');
    mockEstimate = BIG;
    const view = await propose('2015-01-01');

    await fireEvent.press(view.getByTestId('history-range-confirm'));

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
    expect(mockSyncDateRange.mock.calls[0][0]).toBe('2015-01-01');
    expect(alert).not.toHaveBeenCalled();
    expect(view.queryByTestId('history-range-confirm')).toBeNull();
  });

  it('expands without a count it does not have', async () => {
    mockSyncDateRange.mockReturnValue('expanded');
    mockEstimate = null;
    const view = await propose('2015-01-01');

    await fireEvent.press(view.getByTestId('history-range-confirm'));

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
  });

  it('withdraws the proposal when the handle is dragged back to the synced edge', async () => {
    mockEstimate = SMALL;
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
    mockEstimate = SMALL;
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
