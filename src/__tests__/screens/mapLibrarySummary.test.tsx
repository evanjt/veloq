import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import MapScreen from '@/app/(tabs)/map';
import { type FfiMapEmptyReason, FfiMapEmptyReason_Tags, MapDistanceBand } from 'veloqrs';

const mockUseMap = jest.fn();
const mockRefetchMapRead = jest.fn();
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
  useSegments: () => ['(tabs)', 'map'],
}));
jest.mock('@/features/maps', () => ({
  AttributionOverlay: () => null,
  ACTIVITY_CATEGORIES: {
    Ride: { color: 'blue', labelKey: 'ride', types: ['Ride'] },
    Run: { color: 'red', labelKey: 'run', types: ['Run'] },
  },
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  categoryChipColours: () => ({ fill: 'red', ink: 'black' }),
  DEFAULT_MAP_PERIOD: 'all',
  filterSheetExpandedAfterDrag: jest.requireActual('@/features/maps/lib/filterSheet')
    .filterSheetExpandedAfterDrag,
  getPeriodStart: (period: string) => new Date(period === 'all' ? '2000-01-01' : '2026-01-01'),
  groupTypesByCategory: (types: string[]) =>
    new Map<string, string[]>([
      ['Ride', types.filter((type) => type === 'Ride')],
      ['Run', types.filter((type) => type === 'Run')],
    ]),
  MapEmptyState: jest.requireActual('@/features/maps/components/MapEmptyState').MapEmptyState,
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [
    { id: 'all', labelKey: 'all' },
    { id: '1m', labelKey: '1m' },
  ],
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
  useActivityBoundsCache: () => ({
    isReady: true,
    cacheStats: { oldestDate: null, newestDate: null },
  }),
}));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false, colors: {} }),
}));
jest.mock('@/shared/debug/renderTimer', () => ({ logScreenRender: () => () => {} }));
jest.mock('@/shared/ui', () => {
  const { Text } = require('react-native');
  return {
    Button: ({ label }: { label: string }) => <Text>{label}</Text>,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorState: jest.requireActual('@/shared/ui/ErrorState').ErrorState,
    useBottomClearance: jest.requireActual('@/shared/ui/tabBarClearance').useBottomClearance,
    Shimmer: () => null,
    pressable: (style: unknown) => style,
  };
});

describe('map library summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('opens on the period chips and the count line and shows the other filters once the handle is raised', async () => {
    const view = await render(<MapScreen />);
    expect(view.getByText('all')).toBeTruthy();
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.queryByText('Run', { exact: false })).toBeNull();
    expect(view.getByText('292:0')).toBeTruthy();

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.getByText('5–10km')).toBeTruthy();
    expect(view.getByText('Run', { exact: false })).toBeTruthy();
    expect(view.getByText('292:0')).toBeTruthy();

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.getByText('all')).toBeTruthy();
  });

  it('lifts the period chips clear of the tab bar and the navigation bar under it', async () => {
    const view = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 48 }}>
        <MapScreen />
      </SafeAreaInsetsContext.Provider>
    );
    let sheet = view.getByTestId('map-filter-handle').parent;
    while (sheet && StyleSheet.flatten(sheet.props.style)?.paddingBottom === undefined) {
      sheet = sheet.parent;
    }
    // The bar draws the tab row over the inset and its gradient above that.
    expect(StyleSheet.flatten(sheet?.props.style).paddingBottom).toBeGreaterThanOrEqual(80 + 48);
  });

  it('keeps a distance filter applied while the sheet is lowered', async () => {
    const view = await render(<MapScreen />);
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await fireEvent.press(view.getByText('5–10km'));
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceBand: MapDistanceBand.Short })
    );
  });

  it('shows the full library while mapped activities arrive and narrows the mapped count', async () => {
    const view = await render(<MapScreen />);
    await fireEvent.press(view.getByTestId('map-filter-handle'));
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
    await view.rerender(<MapScreen />);
    expect(view.getByText('292:2')).toBeTruthy();

    await fireEvent.press(view.getByText('Run', { exact: false }));
    expect(view.getByText('292:1')).toBeTruthy();
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedTypes: new Set(['Run', 'VirtualRun', 'TrailRun', 'Treadmill']),
      })
    );
    expect(mockMapView).toHaveBeenCalledWith(
      expect.objectContaining({ activities: [{ id: 'run-1', type: 'Run' }] })
    );

    await fireEvent.press(view.getByText('5–10km'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedTypes: new Set(['Run', 'VirtualRun', 'TrailRun', 'Treadmill']),
        distanceBand: MapDistanceBand.Short,
      })
    );
  });
});

describe('map with its screen read failing', () => {
  const answered = {
    activities: [{ id: 'ride-1', type: 'Ride' }],
    availableTypes: ['Ride'],
    categoryCounts: [{ category: 'Ride', count: 1 }],
    totalCount: 1,
    isError: false,
    error: undefined,
    refetch: mockRefetchMapRead,
  };
  const failed = {
    ...answered,
    activities: [],
    availableTypes: [],
    categoryCounts: [],
    totalCount: 0,
    isError: true,
    error: { tag: 'Busy', message: 'a job is running' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMap.mockReturnValue(failed);
  });

  it('keeps the map and its filters and shows the failure with a Retry', async () => {
    const view = await render(<MapScreen />);
    expect(view.getByTestId('regional-map')).toBeTruthy();
    expect(view.getByTestId('map-filter-handle')).toBeTruthy();
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();
    expect(view.getByText('engine.failure.busy')).toBeTruthy();

    await fireEvent.press(view.getByText('common.retry'));
    expect(mockRefetchMapRead).toHaveBeenCalledTimes(1);
  });

  it('drops the failure once the read answers', async () => {
    const view = await render(<MapScreen />);
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();
    mockUseMap.mockReturnValue(answered);
    await view.rerender(<MapScreen />);
    expect(view.queryByTestId('map-activities-failed')).toBeNull();
    expect(mockMapView).toHaveBeenLastCalledWith(
      expect.objectContaining({ activities: [{ id: 'ride-1', type: 'Ride' }] })
    );
  });
});

describe('map with no activity to draw', () => {
  const emptyBecause = (tag: FfiMapEmptyReason_Tags, inner?: Record<string, number>) =>
    ({ tag, inner }) as unknown as FfiMapEmptyReason;
  const read = (emptyReason: FfiMapEmptyReason | undefined) => ({
    activities: [],
    availableTypes: ['Ride', 'Run'],
    categoryCounts: [
      { category: 'Ride', count: 0 },
      { category: 'Run', count: 0 },
    ],
    totalCount: 12,
    emptyReason,
    isError: false,
    error: undefined,
    refetch: mockRefetchMapRead,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('names activities without GPS over the map with the count line under it, the sheet lowered', async () => {
    mockUseMap.mockReturnValue(
      read(emptyBecause(FfiMapEmptyReason_Tags.NoGps, { activities: 12 }))
    );
    const view = await render(<MapScreen />);
    expect(view.getByTestId('regional-map')).toBeTruthy();
    expect(view.getByTestId('map-empty-state')).toBeTruthy();
    expect(view.getByText('mapScreen.emptyNoGps')).toBeTruthy();
    expect(view.getByText('12:0')).toBeTruthy();
    expect(view.queryByText('5–10km')).toBeNull();
  });

  it('names tracks still to download with how many', async () => {
    mockUseMap.mockReturnValue(
      read(emptyBecause(FfiMapEmptyReason_Tags.TracksPending, { activities: 12, pending: 7 }))
    );
    const view = await render(<MapScreen />);
    expect(view.getByText('mapScreen.emptyTracksPending')).toBeTruthy();
    expect(mockTranslate).toHaveBeenCalledWith('mapScreen.emptyTracksPendingHint', { count: 7 });
  });

  it('offers the whole library for an empty period, and the sync range once on it', async () => {
    mockUseMap.mockReturnValue(read(emptyBecause(FfiMapEmptyReason_Tags.NoActivities)));
    const view = await render(<MapScreen />);
    await fireEvent.press(view.getByText('1m'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: new Date('2026-01-01') })
    );

    await fireEvent.press(view.getByText('mapScreen.emptyShowAllTime'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: new Date('2000-01-01') })
    );
    expect(view.queryByText('mapScreen.emptyShowAllTime')).toBeNull();
    expect(view.getByText('mapScreen.emptyNoActivitiesAllTimeHint')).toBeTruthy();
  });

  it('clears the filters that hide every track', async () => {
    mockUseMap.mockReturnValue(read(emptyBecause(FfiMapEmptyReason_Tags.Filtered, { mapped: 4 })));
    const view = await render(<MapScreen />);
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await fireEvent.press(view.getByText('5–10km'));
    await fireEvent.press(view.getByText('Run', { exact: false }));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceBand: MapDistanceBand.Short })
    );

    await fireEvent.press(view.getByText('mapScreen.emptyClearFilters'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        distanceBand: MapDistanceBand.All,
        selectedTypes: new Set(),
        nameNeedle: '',
      })
    );
  });

  it('draws no explanation while the map draws an activity', async () => {
    mockUseMap.mockReturnValue({
      ...read(undefined),
      activities: [{ id: 'ride-1', type: 'Ride' }],
    });
    const view = await render(<MapScreen />);
    expect(view.queryByTestId('map-empty-state')).toBeNull();
  });
});
