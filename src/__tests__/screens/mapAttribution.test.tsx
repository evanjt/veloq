/**
 * Scenario: the Map tab credits its basemap over the map, above the filter sheet.
 * Expected behaviour: one attribution bar, the shared overlay, carried inside the
 * sheet on its top edge, clear of its rounded corners, and themed by the app
 * rather than the basemap. The
 * map's popups clear the sheet and the credit as measured, and the sheet never
 * grows past the space under the map's top controls.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, within, type RenderResult } from '@testing-library/react-native';
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

  it('rides inside the sheet, on its top edge, so a drag moves both in one layout', async () => {
    const view = await renderStaged(<MapScreen />);
    jest.useFakeTimers();
    await layOut(view, 'map-filter-lowered', 140);
    const sheet = view.getByTestId('map-filter-sheet');
    const lane = within(sheet).getByTestId('map-attribution-lane');
    expect(within(lane).getByTestId('map-attribution-bar')).toBeTruthy();
    expect(StyleSheet.flatten(lane.props.style).bottom).toBe('100%');
    // Nothing of the credit's own animates: it moves only because the sheet does.
    expect(getAnimatedStyle(lane)).toEqual({});

    const lowered = sheetHeight(view);
    await layOut(view, 'map-filter-lowered', 360);
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 220);
    expect(within(view.getByTestId('map-filter-sheet')).getByTestId('map-attribution-lane')).toBe(
      view.getByTestId('map-attribution-lane')
    );
  });

  it("keeps the sheet's top corners rounded, the credit standing clear of them", async () => {
    const view = await renderStaged(<MapScreen />);
    const body = StyleSheet.flatten(view.getByTestId('map-filter-sheet-body').props.style);
    const radius = body.borderTopLeftRadius as number;
    expect(radius).toBeGreaterThan(0);
    expect(body.borderTopRightRadius).toBe(radius);
    expect(body.overflow).toBe('hidden');

    const credit = StyleSheet.flatten(view.getByTestId('map-attribution').props.style);
    expect(credit.left).toBeGreaterThanOrEqual(radius);
    expect(credit.right).toBeGreaterThanOrEqual(radius);
    expect(view.getByTestId('map-attribution-text').props.numberOfLines).toBeUndefined();
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
