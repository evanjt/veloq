import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';
import { MapDistanceBand } from 'veloqrs';

const mockUseMap = jest.fn();
const mockRefetchActivities = jest.fn();
const mockActivitiesRead: { isError: boolean; error: unknown } = { isError: false, error: null };
const mockMapView = jest.fn((_props: unknown) => null);
const mockTranslate = jest.fn((key: string, options?: { count?: number; mapped?: number }) => {
  if (key === 'mapScreen.activitySummary') return `${options?.count}:${options?.mapped}`;
  if (key.startsWith('maps.activityTypes.')) {
    const category = key.split('.').at(-1) ?? '';
    return category[0].toUpperCase() + category.slice(1);
  }
  return key;
});

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/features/maps', () => ({
  ACTIVITY_CATEGORIES: {
    Ride: { color: 'blue', labelKey: 'ride', types: ['Ride'] },
    Run: { color: 'red', labelKey: 'run', types: ['Run'] },
  },
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  categoryChipColours: () => ({ fill: 'red', ink: 'black' }),
  DEFAULT_MAP_PERIOD: 'all',
  filterSheetExpandedAfterDrag: jest.requireActual('@/features/maps/lib/filterSheet')
    .filterSheetExpandedAfterDrag,
  getPeriodStart: () => new Date('2026-01-01'),
  groupTypesByCategory: (types: string[]) =>
    new Map<string, string[]>([
      ['Ride', types.filter((type) => type === 'Ride')],
      ['Run', types.filter((type) => type === 'Run')],
    ]),
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [{ id: 'all', labelKey: 'all' }],
  RegionalMapView: (props: unknown) => {
    const { View } = require('react-native');
    mockMapView(props);
    return <View testID="regional-map" />;
  },
  SyncProgressBanner: () => null,
  useEngineMapActivities: (options: unknown) => mockUseMap(options),
  useHeatmapPreference: (select: (s: unknown) => unknown) => select({ routesVisible: false }),
}));
jest.mock('@/features/activity', () => ({
  useActivities: () => ({ ...mockActivitiesRead, refetch: mockRefetchActivities }),
  useActivityBoundsCache: () => ({
    isReady: true,
    cacheStats: { oldestDate: null, newestDate: null },
  }),
}));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false, colors: {} }),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (state: { isAuthenticated: boolean }) => boolean) =>
    select({ isAuthenticated: true }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: () => null,
}));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui', () => {
  const { Text } = require('react-native');
  return {
    Button: ({ label }: { label: string }) => <Text>{label}</Text>,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorStatePreset: () => null,
    EngineReadFailureRetry: jest.requireActual('@/shared/ui/EngineReadFailureRetry')
      .EngineReadFailureRetry,
    useTabBarClearance: () => 0,
    Shimmer: () => null,
    pressable: (style: unknown) => style,
  };
});

describe('map library summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivitiesRead.isError = false;
    mockActivitiesRead.error = null;
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 0 },
        { category: 'Run', count: 0 },
      ],
      totalCount: 292,
    });
  });

  it('opens on the period chips alone and shows the other filters once the handle is raised', () => {
    const view = render(<MapScreen />);
    expect(view.getByText('all')).toBeTruthy();
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.queryByText('Run', { exact: false })).toBeNull();
    expect(view.queryByText('292:0')).toBeNull();

    fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.getByText('5–10km')).toBeTruthy();
    expect(view.getByText('Run', { exact: false })).toBeTruthy();
    expect(view.getByText('292:0')).toBeTruthy();

    fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.getByText('all')).toBeTruthy();
  });

  it('keeps a distance filter applied while the sheet is lowered', () => {
    const view = render(<MapScreen />);
    fireEvent.press(view.getByTestId('map-filter-handle'));
    fireEvent.press(view.getByText('5–10km'));
    fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceBand: MapDistanceBand.Short })
    );
  });

  it('shows the full library while mapped activities arrive and narrows the mapped count', () => {
    const view = render(<MapScreen />);
    fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.getByText('292:0')).toBeTruthy();

    mockUseMap.mockImplementation(({ selectedTypes }: { selectedTypes: Set<string> }) => ({
      activities: [
        { id: 'ride-1', type: 'Ride' },
        { id: 'run-1', type: 'Run' },
      ].filter((activity) => selectedTypes.size === 0 || selectedTypes.has(activity.type)),
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 1 },
        { category: 'Run', count: 1 },
      ],
      totalCount: 292,
    }));
    view.rerender(<MapScreen />);
    expect(view.getByText('292:2')).toBeTruthy();

    fireEvent.press(view.getByText('Run', { exact: false }));
    expect(view.getByText('292:1')).toBeTruthy();
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedTypes: new Set(['Run', 'VirtualRun', 'TrailRun', 'Treadmill']),
      })
    );
    expect(mockMapView).toHaveBeenCalledWith(
      expect.objectContaining({ activities: [{ id: 'run-1', type: 'Run' }] })
    );

    fireEvent.press(view.getByText('5–10km'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedTypes: new Set(['Run', 'VirtualRun', 'TrailRun', 'Treadmill']),
        distanceBand: MapDistanceBand.Short,
      })
    );
  });
});

describe('map with the activities read failing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivitiesRead.isError = true;
    mockActivitiesRead.error = { tag: 'Database' };
    mockUseMap.mockReturnValue({
      activities: [{ id: 'ride-1', type: 'Ride' }],
      availableTypes: ['Ride'],
      categoryCounts: [{ category: 'Ride', count: 1 }],
      totalCount: 1,
    });
  });

  it('keeps the map and its filters and shows the failure with a Retry', () => {
    const view = render(<MapScreen />);
    expect(view.getByTestId('regional-map')).toBeTruthy();
    expect(mockMapView).toHaveBeenCalledWith(
      expect.objectContaining({ activities: [{ id: 'ride-1', type: 'Ride' }] })
    );
    expect(view.getByTestId('map-filter-handle')).toBeTruthy();
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();

    fireEvent.press(view.getByText('common.retry'));
    expect(mockRefetchActivities).toHaveBeenCalledTimes(1);
  });

  it('drops the failure once the read answers', () => {
    const view = render(<MapScreen />);
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();
    mockActivitiesRead.isError = false;
    mockActivitiesRead.error = null;
    view.rerender(<MapScreen />);
    expect(view.queryByTestId('map-activities-failed')).toBeNull();
    expect(view.getByTestId('regional-map')).toBeTruthy();
  });
});
