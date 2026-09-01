/**
 * Scenario: the history slider can reach the athlete's first-ever activity, so
 * one drag to the left edge can start an unbounded download.
 *
 * Expected behaviour: past the large-history threshold the panel asks before it
 * expands, and a refused prompt leaves the synced range exactly where it was.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';

const mockSyncDateRange = jest.fn();
let mockSliderRangeChange: ((start: Date, end: Date) => void) | null = null;
let mockYearCounts: Record<string, number> = {};

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/features/maps/components', () => {
  const { View } = require('react-native');
  return {
    TimelineSlider: (props: { onRangeChange: (start: Date, end: Date) => void }) => {
      mockSliderRangeChange = props.onRangeChange;
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

jest.mock('@/shared/app/useActivityYearCounts', () => ({
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
      isFetchingExtended: false,
      isGpsSyncing: false,
      gpsSyncProgress: { percent: 0, message: '', completed: 0, total: 0 },
      isExpansionLocked: false,
    }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

jest.mock('@/features/maps/hooks/useHeatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/tmp/heatmap',
  getHeatmapTilesCacheSize: () => 0,
}));

function dragTo(year: number) {
  render(<SyncRangePanel />);
  mockSliderRangeChange?.(new Date(`${year}-01-01T00:00:00`), new Date());
}

describe('the history slider gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSliderRangeChange = null;
    mockYearCounts = {};
  });

  it('expands straight away when the widening is small', () => {
    mockYearCounts = { '2025': 40, '2026': 60 };
    dragTo(2025);

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
  });

  it('asks before expanding when the widening is large', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockYearCounts = { '2015': 700, '2025': 40, '2026': 60 };
    dragTo(2015);

    expect(alert).toHaveBeenCalled();
    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });

  it('expands once the prompt is confirmed', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[buttons.length - 1]?.onPress?.();
    });
    mockYearCounts = { '2015': 700, '2025': 40, '2026': 60 };
    dragTo(2015);

    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
  });

  it('leaves the range alone when the prompt is cancelled', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[0]?.onPress?.();
    });
    mockYearCounts = { '2015': 700, '2025': 40, '2026': 60 };
    dragTo(2015);

    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });

  it('does not block the user behind a count it does not have', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockYearCounts = {};
    dragTo(2015);

    expect(alert).not.toHaveBeenCalled();
    expect(mockSyncDateRange).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag that does not widen the range', () => {
    mockYearCounts = { '2015': 700 };
    render(<SyncRangePanel />);
    mockSliderRangeChange?.(new Date('2026-08-01T00:00:00'), new Date());

    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });
});
