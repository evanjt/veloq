/**
 * Scenario: the Map tab credits its basemap, with the filter sheet over the map.
 * Expected behaviour: the credit is a line inside the sheet under its handle, with no bar
 * drawn over the map, themed by the app rather than the basemap. The map's popups clear the
 * sheet, its credit line included, as measured, and the sheet never grows past the space under
 * the map's top controls.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, within, type RenderResult } from '@testing-library/react-native';
import MapScreen from '@/app/(tabs)/map';
import { renderStaged } from '../__shared__/stagedRender';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';
import { darkColors } from '@/theme';

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
// The credit line reads the theme from its own module, not the shared barrel.
jest.mock('@/shared/app/useTheme', () => ({
  ...jest.requireActual('@/shared/app/useTheme'),
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

describe('map tab attribution', () => {
  afterEach(() => {
    mockBasemapDark = false;
    mockAppDark = false;
    jest.useRealTimers();
  });

  it('credits the basemap once, as a line in the sheet with no bar over the map', async () => {
    const view = await renderStaged(<MapScreen />);
    expect(view.queryAllByTestId('map-attribution-bar')).toHaveLength(0);
    expect(view.getAllByText(MOCK_CREDIT)).toHaveLength(1);
    expect(view.getByTestId('map-attribution-text').props.children).toBe(MOCK_CREDIT);
  });

  it('draws the credit under the handle inside the sheet, so a drag moves both in one layout', async () => {
    const view = await renderStaged(<MapScreen />);
    jest.useFakeTimers();
    await layOut(view, 'map-filter-lowered', 140);
    const body = within(view.getByTestId('map-filter-sheet')).getByTestId('map-filter-sheet-body');
    expect(within(body).getByTestId('map-filter-handle')).toBeTruthy();
    const credit = within(body).getByTestId('map-sheet-credit');
    expect(within(credit).getByTestId('map-attribution-text').props.children).toBe(MOCK_CREDIT);
    expect(
      within(view.getByTestId('map-filter-scroll')).queryByTestId('map-sheet-credit')
    ).toBeNull();
    // Nothing of the credit's own animates: it moves only because the sheet does.
    expect(getAnimatedStyle(credit)).toEqual({});

    const lowered = sheetHeight(view);
    await layOut(view, 'map-filter-lowered', 360);
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 220);
  });

  it("keeps the sheet's top corners rounded, with no credit drawn over the map", async () => {
    const view = await renderStaged(<MapScreen />);
    const body = StyleSheet.flatten(view.getByTestId('map-filter-sheet-body').props.style);
    const radius = body.borderTopLeftRadius as number;
    expect(radius).toBeGreaterThan(0);
    expect(body.borderTopRightRadius).toBe(radius);
    expect(body.overflow).toBe('hidden');
    expect(view.queryByTestId('map-attribution')).toBeNull();
    expect(view.getByTestId('map-attribution-text').props.numberOfLines).toBeUndefined();
  });

  it('hands the map the sheet with its credit line included, as the line is measured', async () => {
    const view = await renderStaged(<MapScreen />);
    jest.useFakeTimers();
    await layOut(view, 'map-sheet-credit', 40);
    await layOut(view, 'map-filter-lowered', 140);
    const lowered = sheetHeight(view);
    expect(mockMapClearance).toBe(lowered);

    await layOut(view, 'map-sheet-credit', 64);
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 24);
    expect(mockMapClearance).toBe(lowered + 24);

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await layOut(view, 'map-filter-raised', 320);
    await act(async () => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 24 + 320);
    expect(mockMapClearance).toBe(lowered + 24 + 320);
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
