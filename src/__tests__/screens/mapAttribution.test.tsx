/**
 * Scenario: the Map tab credits its basemap over the map, above the filter sheet.
 * Expected behaviour: one bounded attribution pill, the shared overlay, sitting on
 * the sheet's measured top edge and themed by the basemap rather than the app.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';
import { darkColors } from '@/theme';

const MOCK_CREDIT = '© Invented Tiles © Example Contributors';
let mockBasemapDark = false;
let mockAppDark = false;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'map'],
}));
jest.mock('@/features/maps', () => ({
  AttributionOverlay: jest.requireActual('@/features/maps/components/AttributionOverlay')
    .AttributionOverlay,
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  DEFAULT_MAP_PERIOD: 'all',
  filterSheetExpandedAfterDrag: jest.requireActual('@/features/maps/lib/filterSheet')
    .filterSheetExpandedAfterDrag,
  getPeriodStart: () => new Date('2026-01-01'),
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [{ id: 'all', labelKey: 'all' }],
  RegionalMapView: ({
    onAttributionChange,
  }: {
    onAttributionChange?: (attribution: string, isDark: boolean) => void;
  }) => {
    const { View } = require('react-native');
    require('react').useEffect(() => {
      onAttributionChange?.(MOCK_CREDIT, mockBasemapDark);
    }, [onAttributionChange]);
    return <View testID="regional-map" />;
  },
  SyncProgressBanner: () => null,
  useEngineMapActivities: () => ({
    activities: [],
    availableTypes: [],
    categoryCounts: [],
    totalCount: 0,
  }),
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
  useTheme: () => ({ isDark: mockAppDark, colors: {} }),
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

describe('map tab attribution', () => {
  afterEach(() => {
    mockBasemapDark = false;
    mockAppDark = false;
  });

  it('credits the basemap once, through the shared bounded overlay', async () => {
    const view = await render(<MapScreen />);
    expect(view.getAllByTestId('map-attribution-pill')).toHaveLength(1);
    expect(view.getAllByText(MOCK_CREDIT)).toHaveLength(1);
    expect(view.getByTestId('map-attribution-text').props.children).toBe(MOCK_CREDIT);
  });

  it('sits on the top edge of the sheet as measured, and follows it as it grows', async () => {
    const view = await render(<MapScreen />);
    const lane = () => view.getByTestId('map-attribution-lane');
    const sheet = view.getByTestId('map-filter-sheet');

    await fireEvent(sheet, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 140 } },
    });
    expect(StyleSheet.flatten(lane().props.style).bottom).toBe(140);

    await fireEvent(sheet, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 360 } },
    });
    expect(StyleSheet.flatten(lane().props.style).bottom).toBe(360);
  });

  it('themes the pill by the basemap, not by the app theme', async () => {
    mockBasemapDark = true;
    mockAppDark = false;
    const onDarkMap = await render(<MapScreen />);
    expect(
      StyleSheet.flatten(onDarkMap.getByTestId('map-attribution-text').props.style).color
    ).toBe(darkColors.textSecondary);
    onDarkMap.unmount();

    mockBasemapDark = false;
    mockAppDark = true;
    const onLightMap = await render(<MapScreen />);
    expect(
      StyleSheet.flatten(onLightMap.getByTestId('map-attribution-text').props.style).color
    ).not.toBe(darkColors.textSecondary);
  });
});
