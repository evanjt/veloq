import React from 'react';
import MapScreen from '@/app/(tabs)/map';
import { renderStaged } from '../__shared__/stagedRender';

const mockUseMap = jest.fn();
let mockRouteMatchingEnabled = true;
let mockParams: { activity?: string; section?: string } = {};
const mockMapView = jest.fn((_props: unknown) => null);
const mockTranslate = jest.fn((key: string, options?: { count?: number; mapped?: number }) => {
  if (key === 'mapScreen.activitySummary') return `${options?.count}:${options?.mapped}`;
  if (key.startsWith('sportFamilies.')) {
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
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/maps', () => ({
  ...jest.requireActual('@/features/maps/lib/filterSheet'),
  ATTRIBUTION_CLEARANCE: 26,
  AttributionOverlay: () => null,
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  DEFAULT_MAP_PERIOD: 'all',
  getPeriodStart: () => new Date('2026-01-01'),
  groupTypesByCategory: (types: string[]) =>
    new Map<string, string[]>([
      ['Ride', types.filter((type) => type === 'Ride')],
      ['Run', types.filter((type) => type === 'Run')],
    ]),
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [{ id: 'all', labelKey: 'all' }],
  periodSelectLabelKey: jest.requireActual('@/features/maps/lib/mapPeriod').periodSelectLabelKey,
  sportChipOrder: jest.requireActual('@/features/maps/lib/sportChipOrder').sportChipOrder,
  RegionalMapView: (props: unknown) => mockMapView(props),
  SyncProgressBanner: () => null,
  useEngineMapActivities: (options: unknown) => ({
    unmapped: { withoutGps: 0, downloading: 0 },
    ...mockUseMap(options),
  }),
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
  const { Text } = require('react-native');
  return {
    SelectButton: () => null,
    Button: ({ label }: { label: string }) => <Text>{label}</Text>,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorState: () => null,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
    Shimmer: () => null,
    PressTarget: require('react-native').Pressable,
    TextLink: jest.requireActual('@/shared/ui/TextLink').TextLink,
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

  it('hands the engine read, the map view and the deep link the switch when it is off', async () => {
    mockRouteMatchingEnabled = false;
    await renderStaged(<MapScreen />);
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionsEnabled: false })
    );
    const props = mockMapView.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.sectionsEnabled).toBe(false);
    expect(props.selectSectionId).toBeUndefined();
  });

  it('carries the switch and the deep-linked section through when it is on', async () => {
    mockRouteMatchingEnabled = true;
    await renderStaged(<MapScreen />);
    expect(mockUseMap).toHaveBeenLastCalledWith(expect.objectContaining({ sectionsEnabled: true }));
    const props = mockMapView.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.sectionsEnabled).toBe(true);
    expect(props.selectSectionId).toBe('section-1');
  });
});
