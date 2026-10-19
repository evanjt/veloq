/**
 * Scenario: on the Map tab the filter sheet covers the foot of the screen, and raised it grows
 * well past any fixed offset, while a ride waits for review and the terrain page falls back.
 *
 * Expected behaviour: the tab reports the sheet and its credit as the stack's cover while it is
 * in front, so the recording pill sits above the measured sheet and the terrain notice above the
 * pill, and the cover goes when the tab does.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import MapScreen from '@/app/(tabs)/map';
import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { BottomPillStack } from '@/shared/ui/BottomPillStack';
import { useBottomPills } from '@/shared/ui/bottomPills';
import { spacing } from '@/theme';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';

let mockFocused = true;

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'map'],
  usePathname: () => '/map',
  useIsFocused: () => mockFocused,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn() }));
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
  // The regional map's terrain fallback, fired as the page reports no elevation tiles.
  RegionalMapView: () => {
    const { useEffect } = require('react');
    const { useTerrainFallback } = jest.requireActual('@/features/maps/hooks/useTerrainFallback');
    const { onTerrainUnavailable, terrainNotice } = useTerrainFallback(() => {}, 'pillStack');
    useEffect(() => onTerrainUnavailable(), [onTerrainUnavailable]);
    return terrainNotice;
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
  useTheme: () => ({ isDark: false, colors: {} }),
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

type Rendered = Awaited<ReturnType<typeof render>>;

const SHEET = 380;

function bottomOf(view: Rendered, id: string) {
  return StyleSheet.flatten(view.getByTestId(id).props.style).bottom as number;
}

function sheetHeight(view: Rendered) {
  return getAnimatedStyle(view.getByTestId('map-filter-sheet')).height as number;
}

// The raised rows are hidden from screen readers while the sheet is lowered, which the default
// queries skip.
async function layOut(view: Rendered, id: string, height: number) {
  await act(() =>
    fireEvent(view.getByTestId(id, { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
    })
  );
}

function mapTab() {
  return (
    <>
      <MapScreen />
      <BottomPillStack pills={{ recording: <RecordingReturnPill />, tour: null }} />
    </>
  );
}

describe('the map tab bottom pills', () => {
  beforeEach(() => {
    mockFocused = true;
    useBottomPills.setState({ heights: {}, covers: {} });
    useRecordingStore.getState().reset();
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Ride', 'gps');
  });
  afterEach(() => jest.useRealTimers());

  it('stacks the recording pill over the measured sheet and the terrain notice over the pill', async () => {
    const view = await render(mapTab());
    await layOut(view, 'map-filter-lowered', SHEET);
    await layOut(view, 'bottom-pill-recording', 44);
    await layOut(view, 'bottom-pill-terrain', 40);

    const ride = bottomOf(view, 'bottom-pill-recording');
    expect(sheetHeight(view)).toBeGreaterThan(SHEET);
    expect(ride).toBeGreaterThanOrEqual(sheetHeight(view) + spacing.md);
    expect(bottomOf(view, 'bottom-pill-terrain')).toBe(ride + 44 + spacing.xs);
  });

  it('sets the terrain notice above the sheet with no pill below it', async () => {
    useRecordingStore.getState().reset();
    const view = await render(mapTab());
    await layOut(view, 'map-filter-lowered', SHEET);
    await layOut(view, 'bottom-pill-terrain', 40);

    expect(bottomOf(view, 'bottom-pill-terrain')).toBeGreaterThanOrEqual(
      sheetHeight(view) + spacing.md
    );
  });

  it('follows the sheet as it is raised, once it settles', async () => {
    jest.useFakeTimers();
    const view = await render(mapTab());
    await layOut(view, 'map-filter-lowered', 140);
    await layOut(view, 'map-filter-raised', 320);
    await layOut(view, 'bottom-pill-recording', 44);
    const lowered = bottomOf(view, 'bottom-pill-recording');

    await fireEvent.press(view.getByTestId('map-filter-handle'));
    await act(async () => advanceAnimationByTime(400));
    expect(bottomOf(view, 'bottom-pill-recording')).toBe(lowered + 320);
  });

  it('reports no cover while the tab is not in front', async () => {
    mockFocused = false;
    const view = await render(mapTab());
    await layOut(view, 'map-filter-lowered', SHEET);

    expect(useBottomPills.getState().covers).toEqual({});
  });

  it('drops its cover when the tab goes', async () => {
    const view = await render(<MapScreen />);
    await layOut(view, 'map-filter-lowered', SHEET);
    expect(Object.keys(useBottomPills.getState().covers)).toHaveLength(1);

    await view.unmount();
    expect(useBottomPills.getState().covers).toEqual({});
  });
});
