/**
 * Scenario: the Map tab credits its basemap over the map, above the filter sheet.
 * Expected behaviour: one attribution bar, the shared overlay, sitting on
 * the sheet's measured top edge and themed by the app rather than the basemap. The
 * map's popups clear the sheet and the credit as measured, and the sheet never
 * grows past the space under the map's top controls.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, type RenderResult } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';
import { renderStaged } from '../__shared__/stagedRender';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';
import { darkColors } from '@/theme';
import { ATTRIBUTION_CLEARANCE } from '@/features/maps/components/AttributionOverlay';

const MOCK_CREDIT = '© Invented Tiles © Example Contributors';
let mockBasemapDark = false;
let mockAppDark = false;
let mockMapClearance: number | undefined;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
  useIsFocused: () => true,
  useSegments: () => ['(tabs)', 'map'],
}));
jest.mock('@/features/maps', () => ({
  ATTRIBUTION_CLEARANCE: jest.requireActual('@/features/maps/components/AttributionOverlay')
    .ATTRIBUTION_CLEARANCE,
  AttributionOverlay: jest.requireActual('@/features/maps/components/AttributionOverlay')
    .AttributionOverlay,
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  DEFAULT_MAP_PERIOD: 'all',
  ...jest.requireActual('@/features/maps/lib/filterSheet'),
  getPeriodStart: () => new Date('2026-01-01'),
  MapNameSearch: () => null,
  PERIOD_OPTIONS: [{ id: 'all', labelKey: 'all' }],
  periodSelectLabelKey: jest.requireActual('@/features/maps/lib/mapPeriod').periodSelectLabelKey,
  sportChipOrder: jest.requireActual('@/features/maps/lib/sportChipOrder').sportChipOrder,
  RegionalMapView: ({
    onAttributionChange,
    bottomClearance,
  }: {
    onAttributionChange?: (attribution: string, isDark: boolean) => void;
    bottomClearance?: number;
  }) => {
    const { View } = require('react-native');
    mockMapClearance = bottomClearance;
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
    unmapped: { withoutGps: 0, downloading: 0 },
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
    SelectButton: () => null,
    Button: ({ label }: { label: string }) => <Text>{label}</Text>,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorState: jest.requireActual('@/shared/ui/ErrorState').ErrorState,
    useBottomClearance: jest.requireActual('@/shared/ui/tabBarClearance').useBottomClearance,
    Shimmer: () => null,
    PressTarget: require('react-native').Pressable,
    TextLink: jest.requireActual('@/shared/ui/TextLink').TextLink,
  };
});

// The raised rows are hidden from screen readers while the sheet is lowered, which the default
// queries skip.
const HIDDEN = { includeHiddenElements: true };

async function layOut(view: RenderResult, testID: string, height: number) {
  await act(async () => {
    await fireEvent(view.getByTestId(testID, HIDDEN), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
    });
  });
}

const sheetHeight = (view: RenderResult) =>
  getAnimatedStyle(view.getByTestId('map-filter-sheet')).height as number;
const laneBottom = (view: RenderResult) =>
  getAnimatedStyle(view.getByTestId('map-attribution-lane')).bottom as number;

describe('map tab attribution', () => {
  afterEach(() => {
    mockBasemapDark = false;
    mockAppDark = false;
    jest.useRealTimers();
  });

  it('credits the basemap once, through the shared overlay', async () => {
    const view = await renderStaged(<MapScreen />);
    expect(view.getAllByTestId('map-attribution-bar')).toHaveLength(1);
    expect(view.getAllByText(MOCK_CREDIT)).toHaveLength(1);
    expect(view.getByTestId('map-attribution-text').props.children).toBe(MOCK_CREDIT);
  });

  it('sits on the top edge of the sheet as measured, and follows it as it grows', async () => {
    // The staged first visit waits on a real frame; the sheet's animations then run on fake time.
    const view = await renderStaged(<MapScreen />);
    jest.useFakeTimers();
    await layOut(view, 'map-filter-lowered', 140);
    const lowered = sheetHeight(view);
    expect(lowered).toBeGreaterThan(140);
    expect(laneBottom(view)).toBe(lowered);

    await layOut(view, 'map-filter-lowered', 360);
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 220);
    expect(laneBottom(view)).toBe(lowered + 220);
  });

  it('hands the map the raised sheet and its credit to clear, as measured', async () => {
    const view = await renderStaged(<MapScreen />);
    jest.useFakeTimers();
    await layOut(view, 'map-filter-lowered', 140);
    await layOut(view, 'map-filter-raised', 320);
    const lowered = sheetHeight(view);
    expect(mockMapClearance).toBeGreaterThanOrEqual(lowered + ATTRIBUTION_CLEARANCE);

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await act(async () => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 320);
    expect(mockMapClearance).toBeGreaterThanOrEqual(lowered + 320 + ATTRIBUTION_CLEARANCE);

    await fireEvent(view.getByTestId('map-attribution-bar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 40 } },
    });
    expect(mockMapClearance).toBeGreaterThanOrEqual(lowered + 320 + 40);
  });

  it('bounds the raised sheet by the space under the top controls', async () => {
    const view = await renderStaged(<MapScreen />);
    await fireEvent(view.getByTestId('map-screen'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } },
    });
    await fireEvent.press(view.getByTestId('map-filter-handle'));

    const sheetStyle = StyleSheet.flatten(view.getByTestId('map-filter-sheet').props.style);
    expect(sheetStyle.maxHeight).toBeGreaterThan(0);
    expect(sheetStyle.maxHeight).toBeLessThan(600);
    expect(view.getByTestId('map-filter-scroll')).toBeTruthy();
  });

  it('themes the bar by the app, not by the basemap drawn under it', async () => {
    mockBasemapDark = false;
    mockAppDark = true;
    const darkAppOnLightMap = await renderStaged(<MapScreen />);
    expect(
      StyleSheet.flatten(darkAppOnLightMap.getByTestId('map-attribution-text').props.style).color
    ).toBe(darkColors.textSecondary);
    darkAppOnLightMap.unmount();

    mockBasemapDark = true;
    mockAppDark = false;
    const lightAppOnDarkMap = await renderStaged(<MapScreen />);
    expect(
      StyleSheet.flatten(lightAppOnDarkMap.getByTestId('map-attribution-text').props.style).color
    ).not.toBe(darkColors.textSecondary);
  });
});
