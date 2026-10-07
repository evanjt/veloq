import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';
import { MapDistanceBand } from 'veloqrs';

const mockUseMap = jest.fn();
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
  getPeriodStart: () => new Date('2026-01-01'),
  groupTypesByCategory: (types: string[]) =>
    new Map<string, string[]>([
      ['Ride', types.filter((type) => type === 'Ride')],
      ['Run', types.filter((type) => type === 'Run')],
    ]),
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [{ id: 'all', labelKey: 'all' }],
  RegionalMapView: (props: unknown) => mockMapView(props),
  SyncProgressBanner: () => null,
  useEngineMapActivities: (options: unknown) => mockUseMap(options),
  useHeatmapPreference: (select: (s: unknown) => unknown) => select({ routesVisible: false }),
}));
jest.mock('@/features/activity', () => ({
  useActivities: () => ({ isError: false, refetch: jest.fn() }),
  useActivityBoundsCache: () => ({
    isReady: true,
    cacheStats: { oldestDate: null, newestDate: null },
  }),
}));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
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
  return {
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorStatePreset: () => null,
    TAB_BAR_SAFE_PADDING: 0,
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

  it('shows the full library while mapped activities arrive and narrows the mapped count', () => {
    const view = render(<MapScreen />);
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
