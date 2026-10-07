/**
 * Scenario: the history slider can reach the athlete's first-ever activity, so
 * one drag to the left edge can start an unbounded download.
 *
 * Expected behaviour: past the large-history threshold the panel asks before it
 * expands, and a refused prompt leaves the synced range exactly where it was.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
const mockSyncDateRange = jest.fn();
let mockSliderRangeChange: ((start: Date, end: Date) => void) | null = null;
let mockResetKeys: (number | undefined)[] = [];
let mockYearCounts: Record<string, number> = {};

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
      extendedFetch: { phase: 'idle', since: 0 },
      isGpsSyncing: false,
      gpsSyncProgress: { percent: 0, message: '', completed: 0, total: 0 },
      isExpansionLocked: false,
    }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

jest.mock('@/features/maps/lib/heatmapTiles', () => ({
  HEATMAP_TILES_DIR: '/tmp/heatmap',
}));

function dragTo(year: number) {
  render(<SyncRangePanel />);
  mockSliderRangeChange?.(new Date(`${year}-01-01T00:00:00`), new Date());
}

describe('the history slider gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSliderRangeChange = null;
    mockResetKeys = [];
    mockYearCounts = {};
  });

  describe('putting the handle back', () => {
    const distinctKeys = () => new Set(mockResetKeys).size;

    function dragInAct(start: string) {
      act(() => {
        mockSliderRangeChange?.(new Date(`${start}T00:00:00`), new Date());
      });
    }

    it('after Cancel on the large-history prompt', () => {
      jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        buttons?.[0]?.onPress?.();
      });
      mockYearCounts = { '2015': 700, '2025': 40, '2026': 60 };
      render(<SyncRangePanel />);
      const before = distinctKeys();
      dragInAct('2015-01-01');

      expect(distinctKeys()).toBe(before + 1);
    });

    it('after the expansion latch refuses the drag', () => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockSyncDateRange.mockReturnValue('locked');
      mockYearCounts = { '2025': 40, '2026': 60 };
      render(<SyncRangePanel />);
      const before = distinctKeys();
      dragInAct('2025-01-01');

      expect(distinctKeys()).toBe(before + 1);
    });

    it('after a drag that does not widen the range', () => {
      render(<SyncRangePanel />);
      const before = distinctKeys();
      dragInAct('2026-08-01');

      expect(distinctKeys()).toBe(before + 1);
    });

    it('not when the prompt is confirmed', () => {
      jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        buttons?.[buttons.length - 1]?.onPress?.();
      });
      mockSyncDateRange.mockReturnValue('expanded');
      mockYearCounts = { '2015': 700, '2025': 40, '2026': 60 };
      render(<SyncRangePanel />);
      const before = distinctKeys();
      dragInAct('2015-01-01');

      expect(distinctKeys()).toBe(before);
    });

    it('not when a small widening goes through', () => {
      mockSyncDateRange.mockReturnValue('expanded');
      mockYearCounts = { '2025': 40, '2026': 60 };
      render(<SyncRangePanel />);
      const before = distinctKeys();
      dragInAct('2025-01-01');

      expect(distinctKeys()).toBe(before);
    });
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

  it('says why when the expansion latch refuses the drag', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncDateRange.mockReturnValue('locked');
    mockYearCounts = { '2025': 40, '2026': 60 };
    dragTo(2025);

    expect(alert).toHaveBeenCalledWith('settings.rangeLockedTitle', 'settings.rangeLockedMessage');
  });

  it('stays quiet when the expansion goes through', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSyncDateRange.mockReturnValue('expanded');
    mockYearCounts = { '2025': 40, '2026': 60 };
    dragTo(2025);

    expect(alert).not.toHaveBeenCalled();
  });

  it('ignores a drag that does not widen the range', () => {
    mockYearCounts = { '2015': 700 };
    render(<SyncRangePanel />);
    mockSliderRangeChange?.(new Date('2026-08-01T00:00:00'), new Date());

    expect(mockSyncDateRange).not.toHaveBeenCalled();
  });
});
