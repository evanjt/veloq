import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, within, type RenderResult } from '@testing-library/react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import MapScreen from '@/app/(tabs)/map';
import { renderStaged } from '../__shared__/stagedRender';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';
import { TAB_BAR_HEIGHT } from '@/shared/ui/tabBarClearance';
import { typography } from '@/theme';
import { getPeriodStart } from '@/features/maps/lib/mapPeriod';
import { type FfiMapEmptyReason, FfiMapEmptyReason_Tags, MapDistanceBand } from 'veloqrs';

// The period's start is read against one clock, so a choice is compared to the instant it names.
const mockPinnedNow = new Date('2026-03-15T09:30:00');
const mockUseMap = jest.fn();
const mockRefetchMapRead = jest.fn();
const mockNavigateTo = jest.fn();
const mockMapView = jest.fn((_props: unknown) => null);
const mockLogScreenRender = jest.fn((_name: string) => () => {});
const mockTranslate = jest.fn(
  (key: string, options?: { count?: number; mapped?: number; filters?: string }) => {
    if (key === 'mapScreen.activitySummary') return `${options?.count}:${options?.mapped}`;
    if (key === 'mapScreen.unmappedWithoutGps') return `${options?.count} without GPS`;
    if (key === 'mapScreen.unmappedDownloading') return `${options?.count} downloading`;
    if (key === 'mapScreen.searchFilteredBy') return `filtered by ${options?.filters}`;
    if (key.startsWith('sportFamilies.') || key.startsWith('maps.activityTypes.')) {
      const category = key.split('.').at(-1) ?? '';
      return category[0].toUpperCase() + category.slice(1);
    }
    return key;
  }
);

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
  useIsFocused: () => true,
  useSegments: () => ['(tabs)', 'map'],
}));
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));
jest.mock('@/features/maps', () => ({
  ...jest.requireActual('@/features/maps/lib/filterSheet'),
  ...jest.requireActual('@/features/maps/lib/mapPeriod'),
  ...jest.requireActual('@/features/maps/lib/sportChipOrder'),
  ATTRIBUTION_CLEARANCE: 26,
  AttributionOverlay: () => null,
  FILTER_CHIP: { fill: 'teal', ink: 'black' },
  getPeriodStart: (period: 'all') =>
    jest.requireActual('@/features/maps/lib/mapPeriod').getPeriodStart(period, mockPinnedNow),
  groupTypesByCategory: (types: string[]) =>
    new Map<string, string[]>([
      ['Ride', types.filter((type) => type === 'Ride')],
      ['Run', types.filter((type) => type === 'Run')],
    ]),
  MapEmptyState: jest.requireActual('@/features/maps/components/MapEmptyState').MapEmptyState,
  MapNameSearch: ({ onChangeNeedle }: { onChangeNeedle: (text: string) => void }) => {
    const { TextInput } = require('react-native');
    return <TextInput testID="map-search-input" onChangeText={onChangeNeedle} />;
  },
  RegionalMapView: (props: unknown) => {
    const { View } = require('react-native');
    mockMapView(props);
    return <View testID="regional-map" />;
  },
  SyncProgressBanner: () => null,
  useEngineMapActivities: (options: unknown) => ({
    unmapped: { withoutGps: 0, downloading: 0 },
    ...mockUseMap(options),
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
  useTheme: () => ({ isDark: false, colors: {} }),
}));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: (name: string) => mockLogScreenRender(name),
}));
jest.mock('@/shared/ui', () => {
  const { Text } = require('react-native');
  return {
    Button: ({ label, onPress }: { label: string; onPress?: () => void }) => (
      <Text onPress={onPress}>{label}</Text>
    ),
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    ErrorState: jest.requireActual('@/shared/ui/ErrorState').ErrorState,
    useBottomClearance: jest.requireActual('@/shared/ui/tabBarClearance').useBottomClearance,
    SelectButton: jest.requireActual('@/shared/ui/SelectButton').SelectButton,
    Shimmer: () => null,
    PressTarget: require('react-native').Pressable,
    TextLink: jest.requireActual('@/shared/ui/TextLink').TextLink,
  };
});

// The period list opens on the popup's portal.
const mapScreen = () => (
  <PaperProvider>
    <MapScreen />
  </PaperProvider>
);

// The raised rows are hidden from screen readers while the sheet is lowered, which the default
// queries skip.
const HIDDEN = { includeHiddenElements: true };

/** Opens the period list and chooses the row with this label. */
async function choosePeriod(view: RenderResult, label: string) {
  await act(async () => {
    await fireEvent.press(view.getByTestId('map-period-select'));
  });
  await view.findAllByRole('menuitem');
  await act(async () => {
    await fireEvent.press(view.getByLabelText(label));
  });
}

/** The sport chips in the order the row draws them. */
const sportChipOrder = (view: RenderResult) =>
  view.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && /^map-sport-[A-Za-z]+$/.test(node.props.testID ?? '')
  ).map((node) => (node.props.testID as string).slice('map-sport-'.length));

async function layOut(view: RenderResult, testID: string, height: number) {
  await act(async () => {
    await fireEvent(view.getByTestId(testID, HIDDEN), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    });
  });
}

describe('map filter sheet drag', () => {
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
  afterEach(() => jest.useRealTimers());

  async function renderMeasured() {
    // The staged first visit waits on a real frame; the sheet's animations then run on fake time.
    const view = await renderStaged(mapScreen());
    jest.useFakeTimers();
    await layOut(view, 'map-sheet-detail', 30);
    await layOut(view, 'map-filter-lowered', 120);
    await layOut(view, 'map-filter-raised', 200);
    return view;
  }

  const sheetHeight = (view: RenderResult) =>
    getAnimatedStyle(view.getByTestId('map-filter-sheet')).height as number;
  const laneBottom = (view: RenderResult) =>
    getAnimatedStyle(view.getByTestId('map-attribution-lane')).bottom as number;

  it('carries the sheet and the credit lane with the finger before it lifts, with no render', async () => {
    const view = await renderMeasured();
    const lowered = sheetHeight(view);
    expect(lowered).toBeGreaterThan(120);
    expect(laneBottom(view)).toBe(lowered);

    const renders = mockLogScreenRender.mock.calls.length;
    const drag = createGestureController('map-filter-handle-drag');
    act(() => {
      drag.begin();
      drag.activate({ translationY: -80 });
      drag.update({ translationY: -80 });
    });
    expect(sheetHeight(view)).toBe(lowered + 80);
    expect(laneBottom(view)).toBe(lowered + 80);
    expect(mockLogScreenRender.mock.calls.length).toBe(renders);

    await act(async () => {
      drag.end({ translationY: -80, velocityY: -100 });
    });
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 200);
    expect(laneBottom(view)).toBe(lowered + 200);
    expect(view.getByTestId('map-filter-handle').props.accessibilityState).toEqual({
      expanded: true,
    });
    expect(view.getByText('5–10km')).toBeTruthy();
  });

  it('stops at the raised height on a drag past it and lowers on a flick back down', async () => {
    const view = await renderMeasured();
    const lowered = sheetHeight(view);
    const drag = createGestureController('map-filter-handle-drag');
    act(() => {
      drag.begin();
      drag.activate({ translationY: -500 });
      drag.update({ translationY: -500 });
    });
    expect(sheetHeight(view)).toBe(lowered + 200);
    await act(async () => {
      drag.end({ translationY: -500, velocityY: 0 });
    });
    act(() => advanceAnimationByTime(400));

    act(() => {
      drag.begin();
      drag.activate({ translationY: 20 });
      drag.update({ translationY: 20 });
    });
    expect(sheetHeight(view)).toBe(lowered + 180);
    await act(async () => {
      drag.end({ translationY: 20, velocityY: 1200 });
    });
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered);
    expect(view.getByTestId('map-filter-handle').props.accessibilityState).toEqual({
      expanded: false,
    });
    expect(view.queryByText('5–10km')).toBeNull();
  });

  it('returns to the lowered stop after a short slow drag', async () => {
    const view = await renderMeasured();
    const lowered = sheetHeight(view);
    const drag = createGestureController('map-filter-handle-drag');
    act(() => {
      drag.begin();
      drag.activate({ translationY: -16 });
      drag.update({ translationY: -16 });
    });
    expect(sheetHeight(view)).toBe(lowered + 16);
    await act(async () => {
      drag.end({ translationY: -16, velocityY: -100 });
    });
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered);
  });

  it('counts the foot line in the lowered stop and keeps it at the raised one', async () => {
    const view = await renderStaged(mapScreen());
    jest.useFakeTimers();
    await layOut(view, 'map-filter-lowered', 120);
    await layOut(view, 'map-filter-raised', 200);
    const withoutLine = sheetHeight(view);
    await layOut(view, 'map-sheet-detail', 30);
    act(() => advanceAnimationByTime(400));
    const lowered = sheetHeight(view);
    expect(lowered).toBe(withoutLine + 30);

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 200);
  });

  it('animates to the other stop on a tap of the handle', async () => {
    const view = await renderMeasured();
    const lowered = sheetHeight(view);
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered + 200);
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    act(() => advanceAnimationByTime(400));
    expect(sheetHeight(view)).toBe(lowered);
  });
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

  it('opens on the sport chips beside the period button and the count line, and shows the other filters once the handle is raised', async () => {
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 12 },
        { category: 'Run', count: 30 },
      ],
      totalCount: 292,
    });
    const view = await renderStaged(mapScreen());
    const controls = view.getByTestId('map-filter-controls');
    expect(within(controls).getByTestId('map-period-select')).toHaveTextContent('period.long.all');
    expect(within(controls).getByTestId('map-sport-Ride-count')).toHaveTextContent('12');
    expect(within(controls).getByTestId('map-sport-Run-count')).toHaveTextContent('30');
    expect(view.queryByText('period.short.all')).toBeNull();
    expect(view.queryByText('period.short.1m')).toBeNull();
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.getByText('292:0')).toBeTruthy();

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.getByText('5–10km')).toBeTruthy();
    expect(view.getByText('292:0')).toBeTruthy();

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(view.queryByText('5–10km')).toBeNull();
    expect(view.getByTestId('map-period-select')).toBeTruthy();
  });

  it('sets the count on a caption foot line, last in the sheet, with Expand range as a text link to the sync range', async () => {
    const view = await renderStaged(mapScreen());
    const sheet = view.getByTestId('map-filter-sheet');
    const detail = within(sheet).getByTestId('map-sheet-detail');
    const lastInSheet = sheet.children.filter((child) => typeof child !== 'string').at(-1);
    expect(typeof lastInSheet !== 'string' && lastInSheet?.props.testID).toBe('map-sheet-detail');

    const count = within(detail).getByText('292:0');
    expect(StyleSheet.flatten(count.props.style).fontSize).toBe(typography.caption.fontSize);
    const link = within(detail).getByRole('link', { name: 'mapScreen.expandRange' });
    expect(view.getAllByText('mapScreen.expandRange')).toHaveLength(1);
    const linkText = within(link).getByText('mapScreen.expandRange');
    expect(StyleSheet.flatten(linkText.props.style).fontSize).toBe(typography.caption.fontSize);
    await fireEvent.press(link);
    expect(mockNavigateTo).toHaveBeenCalledWith('/sync-settings');

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    const raisedDetail = view.getByTestId('map-sheet-detail');
    expect(within(raisedDetail).getByText('292:0')).toBeTruthy();
    expect(within(raisedDetail).getByRole('link', { name: 'mapScreen.expandRange' })).toBeTruthy();
    expect(mockMapView).toHaveBeenLastCalledWith(expect.objectContaining({ mapLabel: '292:0' }));
  });

  it('names the activities without GPS in the window after the drawn count, and no download part', async () => {
    mockUseMap.mockReturnValue({
      activities: Array.from({ length: 195 }, (_, i) => ({ id: `ride-${i}`, type: 'Ride' })),
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 195 },
        { category: 'Run', count: 0 },
      ],
      totalCount: 245,
      unmapped: { withoutGps: 50, downloading: 0 },
    });
    const view = await renderStaged(mapScreen());
    const detail = view.getByTestId('map-sheet-detail');
    expect(within(detail).getByText('245:195 · 50 without GPS')).toBeTruthy();
    expect(view.queryByText(/downloading/)).toBeNull();
    expect(mockMapView).toHaveBeenLastCalledWith(
      expect.objectContaining({ mapLabel: '245:195 · 50 without GPS' })
    );
  });

  it('names the tracks still downloading after the drawn count, and no GPS part', async () => {
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 0 },
        { category: 'Run', count: 0 },
      ],
      totalCount: 292,
      unmapped: { withoutGps: 0, downloading: 12 },
    });
    const view = await renderStaged(mapScreen());
    const detail = view.getByTestId('map-sheet-detail');
    expect(within(detail).getByText('292:0 · 12 downloading')).toBeTruthy();
    expect(view.queryByText(/without GPS/)).toBeNull();
    expect(mockMapView).toHaveBeenLastCalledWith(
      expect.objectContaining({ mapLabel: '292:0 · 12 downloading' })
    );
  });

  it('names both causes, GPS first, and leaves the line as it was when both are zero', async () => {
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 0 },
        { category: 'Run', count: 0 },
      ],
      totalCount: 292,
      unmapped: { withoutGps: 3, downloading: 1 },
    });
    const view = await renderStaged(mapScreen());
    expect(
      within(view.getByTestId('map-sheet-detail')).getByText(
        '292:0 · 3 without GPS · 1 downloading'
      )
    ).toBeTruthy();

    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 0 },
        { category: 'Run', count: 0 },
      ],
      totalCount: 292,
      unmapped: { withoutGps: 0, downloading: 0 },
    });
    await view.rerender(mapScreen());
    expect(within(view.getByTestId('map-sheet-detail')).getByText('292:0')).toBeTruthy();
    expect(mockMapView).toHaveBeenLastCalledWith(expect.objectContaining({ mapLabel: '292:0' }));
  });

  it('chooses the period from a list on the lowered sheet', async () => {
    const view = await renderStaged(mapScreen());
    await act(async () => {
      await fireEvent.press(view.getByTestId('map-period-select'));
    });
    const rows = await view.findAllByRole('menuitem');
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'period.long.all',
      'maps.periodThisYear',
      'period.long.6m',
      'period.long.3m',
      'period.long.1m',
      'period.long.7d',
    ]);
    const checked = rows.filter((row) => row.props.accessibilityState?.checked);
    expect(checked.map((row) => row.props.accessibilityLabel)).toEqual(['period.long.all']);

    await act(async () => {
      await fireEvent.press(view.getByLabelText('period.long.1m'));
    });
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: getPeriodStart('1m', mockPinnedNow) })
    );
    expect(view.getByTestId('map-period-select')).toHaveTextContent('period.long.1m');
    expect(view.getByTestId('map-period-select').props.accessibilityLabel).toBe(
      'settings.dateRange: period.long.1m'
    );
  });

  it('redraws the sport chips with a new read while lowered, a chosen one kept in front', async () => {
    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 12 },
        { category: 'Run', count: 30 },
      ],
      totalCount: 292,
    });
    const view = await renderStaged(mapScreen());
    expect(sportChipOrder(view)).toEqual(['Run', 'Ride']);
    await fireEvent.press(view.getByTestId('map-sport-Ride'));
    expect(sportChipOrder(view)).toEqual(['Ride', 'Run']);

    mockUseMap.mockReturnValue({
      activities: [],
      availableTypes: ['Ride', 'Run'],
      categoryCounts: [
        { category: 'Ride', count: 2 },
        { category: 'Run', count: 5 },
      ],
      totalCount: 292,
    });
    await choosePeriod(view, 'period.long.1m');
    expect(view.getByTestId('map-sport-Ride-count')).toHaveTextContent('2');
    expect(view.getByTestId('map-sport-Run-count')).toHaveTextContent('5');
    expect(sportChipOrder(view)).toEqual(['Ride', 'Run']);
    expect(view.getByTestId('map-filter-handle').props.accessibilityState).toEqual({
      expanded: false,
    });
  });

  it('lifts the period chips clear of the tab bar and the navigation bar under it', async () => {
    const view = await renderStaged(
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 48 }}>
        {mapScreen()}
      </SafeAreaInsetsContext.Provider>
    );
    let sheet = view.getByTestId('map-filter-handle').parent;
    while (sheet && StyleSheet.flatten(sheet.props.style)?.paddingBottom === undefined) {
      sheet = sheet.parent;
    }
    // The bar draws its tab row over the inset.
    expect(StyleSheet.flatten(sheet?.props.style).paddingBottom).toBeGreaterThanOrEqual(
      TAB_BAR_HEIGHT + 48
    );
  });

  it('keeps a distance filter applied while the sheet is lowered', async () => {
    const view = await renderStaged(mapScreen());
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await fireEvent.press(view.getByText('5–10km'));
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceBand: MapDistanceBand.Short })
    );
  });

  it('names the distance and name filters the lowered sheet hides and clears only those there', async () => {
    const runMembers = new Set(['Run', 'VirtualRun', 'TrailRun', 'Treadmill']);
    const view = await renderStaged(mapScreen());
    await fireEvent.press(view.getByTestId('map-sport-Run'));
    expect(view.queryByTestId('map-filter-summary')).toBeNull();
    expect(view.queryByText('mapScreen.emptyClearFilters')).toBeNull();

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await fireEvent.press(view.getByText('5–10km'));
    await fireEvent.changeText(view.getByTestId('map-search-input'), 'harbour loop');
    expect(view.queryByTestId('map-filter-summary')).toBeNull();
    await fireEvent.press(view.getByTestId('map-filter-handle'));

    expect(view.getByTestId('map-filter-summary').props.children).toBe(
      'filtered by 5–10km, harbour loop'
    );
    await fireEvent.press(view.getByText('mapScreen.emptyClearFilters'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        distanceBand: MapDistanceBand.All,
        nameNeedle: '',
        selectedTypes: runMembers,
      })
    );
    expect(view.queryByTestId('map-filter-summary')).toBeNull();
    expect(view.queryByText('mapScreen.emptyClearFilters')).toBeNull();
  });

  it('names a typed name on the lowered sheet and clears it there', async () => {
    const view = await renderStaged(mapScreen());
    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await fireEvent.changeText(view.getByTestId('map-search-input'), '  harbour loop ');
    await fireEvent.press(view.getByTestId('map-filter-handle'));

    expect(view.getByTestId('map-filter-summary').props.children).toBe('filtered by harbour loop');
    await fireEvent.press(view.getByText('mapScreen.emptyClearFilters'));
    expect(mockUseMap).toHaveBeenLastCalledWith(expect.objectContaining({ nameNeedle: '' }));
    expect(view.queryByTestId('map-filter-summary')).toBeNull();
  });

  it('leaves the lowered sheet without a filter line when only the period is chosen', async () => {
    const view = await renderStaged(mapScreen());
    await choosePeriod(view, 'period.long.1m');
    expect(view.queryByTestId('map-filter-summary')).toBeNull();
  });

  it('shows the full library while mapped activities arrive and narrows the mapped count', async () => {
    const view = await renderStaged(mapScreen());
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
    await view.rerender(mapScreen());
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
    const view = await renderStaged(mapScreen());
    expect(view.getByTestId('regional-map')).toBeTruthy();
    expect(view.getByTestId('map-filter-handle')).toBeTruthy();
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();
    expect(view.getByText('engine.failure.busy')).toBeTruthy();

    await fireEvent.press(view.getByText('common.retry'));
    expect(mockRefetchMapRead).toHaveBeenCalledTimes(1);
  });

  it('drops the failure once the read answers', async () => {
    const view = await renderStaged(mapScreen());
    expect(view.getByTestId('map-activities-failed')).toBeTruthy();
    mockUseMap.mockReturnValue(answered);
    await view.rerender(mapScreen());
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
    const view = await renderStaged(mapScreen());
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
    const view = await renderStaged(mapScreen());
    expect(view.getByText('mapScreen.emptyTracksPending')).toBeTruthy();
    expect(mockTranslate).toHaveBeenCalledWith('mapScreen.emptyTracksPendingHint', { count: 7 });
  });

  it('offers the whole library for an empty period, and the sync range once on it', async () => {
    mockUseMap.mockReturnValue(read(emptyBecause(FfiMapEmptyReason_Tags.NoActivities)));
    const view = await renderStaged(mapScreen());
    await choosePeriod(view, 'period.long.1m');
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: getPeriodStart('1m', mockPinnedNow) })
    );

    await fireEvent.press(view.getByText('mapScreen.emptyShowAllTime'));
    expect(mockUseMap).toHaveBeenLastCalledWith(
      expect.objectContaining({ startDate: getPeriodStart('all', mockPinnedNow) })
    );
    expect(view.queryByText('mapScreen.emptyShowAllTime')).toBeNull();
    expect(view.getByText('mapScreen.emptyNoActivitiesAllTimeHint')).toBeTruthy();
  });

  it('clears the filters that hide every track', async () => {
    mockUseMap.mockReturnValue(read(emptyBecause(FfiMapEmptyReason_Tags.Filtered, { mapped: 4 })));
    const view = await renderStaged(mapScreen());
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
    const view = await renderStaged(mapScreen());
    expect(view.queryByTestId('map-empty-state')).toBeNull();
  });
});
