import React from 'react';
import { render } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';

const mockUseMap = jest.fn();
let mockRouteMatchingEnabled = true;
let mockParams: { activity?: string; section?: string } = {};
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
  useLocalSearchParams: () => mockParams,
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
jest.mock('@/features/routes', () => ({
  useRouteSettings: (select: (s: { settings: { enabled: boolean } }) => unknown) =>
    select({ settings: { enabled: mockRouteMatchingEnabled } }),
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

describe('map screen route matching switch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { section: 'section-1' };
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: [],
      categoryCounts: [],
      totalCount: 0,
      sectionCount: 0,
      sections: [],
    });
  });

  it('hands the engine read, the map view and the deep link the switch when it is off', () => {
    mockRouteMatchingEnabled = false;
    render(<MapScreen />);
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionsEnabled: false })
    );
    const props = mockMapView.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.sectionsEnabled).toBe(false);
    expect(props.selectSectionId).toBeUndefined();
  });

  it('carries the switch and the deep-linked section through when it is on', () => {
    mockRouteMatchingEnabled = true;
    render(<MapScreen />);
    expect(mockUseMap).toHaveBeenLastCalledWith(expect.objectContaining({ sectionsEnabled: true }));
    const props = mockMapView.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.sectionsEnabled).toBe(true);
    expect(props.selectSectionId).toBe('section-1');
  });
});
