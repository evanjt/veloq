/**
 * Scenario: the regional map is rendered over a list of activity bounds that
 * may be empty, partly invalid, or missing their start points.
 *
 * Expected behaviour: it mounts, exposes its overlay toggles and the fit-all
 * control, and the toggles stay pressable without a GL context.
 */

import React from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/features/maps/components/RegionalMapView';
import { TERRAIN_UNAVAILABLE_TEST_ID } from '@/features/maps/components/TerrainUnavailableNotice';
import { decodeCoords } from 'veloqrs';
import type { ActivityBoundsItem } from '@/types';
import { stubHardwareBack } from '../../__shared__/hardwareBack';
import { useBottomPills } from '@/shared/ui/bottomPills';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui/tabBarClearance';
import { spacing } from '@/theme';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const mockClearHeatmapView = jest.fn();

jest.mock('@/features/maps/lib/heatmapGeneration', () => ({
  ...jest.requireActual('@/features/maps/lib/heatmapGeneration'),
  clearHeatmapView: () => mockClearHeatmapView(),
}));

let mockPathname = '/map';
let mockGlobalStyle = 'light';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname,
  useSegments: () => ['(tabs)', 'map'],
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getGlobalMapStyle: () => mockGlobalStyle,
    setGlobalMapStyle: jest.fn(),
    getStyleForActivity: () => 'light',
  }),
}));

const mockStatusBarStyles: string[] = [];

jest.mock('expo-status-bar', () => ({
  ...jest.requireActual('expo-status-bar'),
  StatusBar: ({ style }: { style: string }) => {
    mockStatusBarStyles.push(style);
    return null;
  },
}));

const SECTION = {
  id: 'sec-1',
  sectionType: 'auto',
  name: 'Hill Climb',
  sportTypes: ['Ride'],
  polyline: [
    { lat: 46.95, lng: 7.45 },
    { lat: 46.96, lng: 7.46 },
  ],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
};

const mockSectionDetail = jest.fn((id: string | null) => ({
  section: id ? SECTION : null,
}));

jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: (id: string | null) => mockSectionDetail(id),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isHeatmapEnabled: () => true,
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getGpsTrack: () => 'encoded', subscribe: () => () => {} }),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function activity(id: string, overrides: Partial<ActivityBoundsItem> = {}): ActivityBoundsItem {
  return {
    id,
    bounds: [
      [46.94, 7.44],
      [46.96, 7.46],
    ],
    type: 'Ride',
    name: `Ride ${id}`,
    date: '2026-01-15T10:00:00Z',
    distance: 42_000,
    duration: 5400,
    startPoint: [46.948, 7.447],
    ...overrides,
  };
}

function renderRegional(props: Partial<React.ComponentProps<typeof RegionalMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RegionalMapView activities={[activity('a1'), activity('a2')]} {...props} />
    </SafeAreaProvider>
  );
}

describe('RegionalMapView', () => {
  /**
   * Scenario: a link names a section, so the popup opens without a tap on the
   * overlay.
   *
   * Expected behaviour: the popup shows for the named id, and nothing opens
   * when the link names none.
   */
  it('opens the popup for the section a link names', async () => {
    await renderRegional({ selectSectionId: 'sec-1' });

    expect(mockSectionDetail).toHaveBeenCalledWith('sec-1');
    expect(screen.getByTestId('section-popup')).toBeTruthy();
  });

  it('opens no section popup without a section in the link', async () => {
    await renderRegional();

    expect(screen.queryByTestId('section-popup')).toBeNull();
  });

  beforeEach(() => {
    (decodeCoords as jest.Mock).mockReturnValue([{ latitude: 46.95, longitude: 7.45 }]);
    mockPathname = '/map';
  });

  it('mounts a map with activity overlays', async () => {
    await renderRegional();

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('map-layers'));
    expect(screen.getByTestId('map-toggle-activities')).toBeTruthy();
  });

  it('offers fit-all once there is at least one activity', async () => {
    await renderRegional();
    await fireEvent.press(screen.getByTestId('map-layers'));

    expect(screen.getByTestId('map-fit-all')).toBeTruthy();
    await expect(
      (async () => fireEvent.press(screen.getByTestId('map-fit-all')))()
    ).resolves.not.toThrow();
  });

  it('withholds fit-all when there is nothing to fit', async () => {
    await renderRegional({ activities: [] });
    await fireEvent.press(screen.getByTestId('map-layers'));

    expect(screen.queryByTestId('map-fit-all')).toBeNull();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('keeps the overlay toggles pressable', async () => {
    await renderRegional();
    await fireEvent.press(screen.getByTestId('map-layers'));

    for (const id of ['map-toggle-activities', 'map-toggle-heatmap']) {
      await expect((async () => fireEvent.press(screen.getByTestId(id)))()).resolves.not.toThrow();
      await expect((async () => fireEvent.press(screen.getByTestId(id)))()).resolves.not.toThrow();
    }

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  /**
   * Scenario: the markers are drawn into the map canvas, so no automation can
   * tap one. A deep link names the activity to open instead.
   *
   * Expected behaviour: the named activity's popup shows with its actions, the
   * close button dismisses it, and an unknown id opens nothing.
   */
  it('opens the popup for the activity a deep link names, and closes it', async () => {
    await renderRegional({ selectActivityId: 'a2' });

    expect(screen.getByTestId('activity-popup')).toBeTruthy();
    expect(screen.getByText('Ride a2')).toBeTruthy();
    expect(screen.getByTestId('activity-popup-view-details')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('activity-popup-close'));
    expect(screen.queryByTestId('activity-popup')).toBeNull();
  });

  /**
   * Scenario: a popup is open over the Map tab and the athlete presses back.
   *
   * Expected behaviour: back closes the popup and stays on the map, and the
   * next back is left to the navigator.
   */
  it.each([
    ['activity', { selectActivityId: 'a2' }],
    ['section', { selectSectionId: 'sec-1' }],
  ])('closes the %s popup on back', async (kind, props) => {
    const back = stubHardwareBack();
    try {
      await renderRegional(props);
      expect(screen.getByTestId(`${kind}-popup`)).toBeTruthy();

      await act(() => {
        expect(back.press()).toBe(true);
      });

      expect(screen.queryByTestId(`${kind}-popup`)).toBeNull();
      expect(back.press()).toBe(false);
    } finally {
      back.restore();
    }
  });

  /**
   * Scenario: the host's filter sheet is raised, so it and its credit cover the
   * foot of the map far past where a fixed offset would put a popup.
   *
   * Expected behaviour: each popup sits above the clearance the host reports.
   */
  it.each([
    ['activity', { selectActivityId: 'a2' }],
    ['section', { selectSectionId: 'sec-1' }],
  ])('sets the %s popup above the raised sheet', async (kind, props) => {
    await renderRegional({ ...props, bottomClearance: 460 });

    const style = StyleSheet.flatten(screen.getByTestId(`${kind}-popup`).props.style);
    expect(style.bottom).toBeGreaterThanOrEqual(460);
  });

  it('opens no popup for an activity that is not on the map', async () => {
    await renderRegional({ selectActivityId: 'missing' });

    expect(screen.queryByTestId('activity-popup')).toBeNull();
  });

  it('opens the popup once the named activity arrives', async () => {
    const view = await renderRegional({ activities: [], selectActivityId: 'a1' });
    expect(screen.queryByTestId('activity-popup')).toBeNull();

    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1')]} selectActivityId="a1" />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId('activity-popup')).toBeTruthy();
  });

  it('swaps in the terrain view when 3D is enabled', async () => {
    await renderRegional();

    expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();

    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
  });

  it('falls back to the 2D map and says why when the terrain page has no elevation tiles', async () => {
    await renderRegional();

    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.queryByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeNull();

    await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'message', {
      nativeEvent: {
        data: JSON.stringify({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' }),
      },
    });

    expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    expect(screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID)).toBeTruthy();
  });

  /**
   * Scenario: the raised filter sheet covers the foot of the screen far past a fixed offset,
   * and the terrain page falls back.
   *
   * Expected behaviour: the notice takes the top slot of the bottom pill stack, above the cover
   * the tab reports, and gives the slot up when it clears.
   */
  it('places the terrain notice in the bottom pill stack above the reported cover', async () => {
    jest.useFakeTimers();
    useBottomPills.setState({ heights: {}, covers: { mapSheet: 380 } });
    await renderRegional();

    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    await fireEvent(screen.getByTestId('webview', MAP_PAGE), 'message', {
      nativeEvent: {
        data: JSON.stringify({ type: 'terrainUnavailable', reason: 'no terrain tiles: 6 failed' }),
      },
    });

    const slot = screen.getByTestId('bottom-pill-terrain');
    expect(slot).toContainElement(screen.getByTestId(TERRAIN_UNAVAILABLE_TEST_ID));
    expect(StyleSheet.flatten(slot.props.style).bottom).toBe(
      TAB_BAR_SAFE_PADDING + 34 + 380 + spacing.md
    );

    await fireEvent(slot, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 40 } },
    });
    expect(useBottomPills.getState().heights.terrain).toBe(40);

    await act(async () => jest.advanceTimersByTime(6000));
    jest.useRealTimers();
    expect(screen.queryByTestId('bottom-pill-terrain')).toBeNull();
    expect(useBottomPills.getState().heights.terrain).toBeUndefined();
  });

  it('tears the surface down when the tab loses focus and rebuilds it on return', async () => {
    const view = await renderRegional();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();

    mockPathname = '/activity/a1';
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();

    mockPathname = '/map';
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  /**
   * Scenario: in the light app theme the athlete cycles the map from the light
   * style through dark to satellite and back, all drawn under the status bar.
   *
   * Expected behaviour: the status bar takes light glyphs over the dark style
   * and the imagery, dark ones over the light style, and sets nothing once the
   * tab loses focus.
   */
  it('sets the status bar style from the map style while the tab is focused', async () => {
    mockStatusBarStyles.length = 0;
    const view = await renderRegional();
    expect(mockStatusBarStyles.at(-1)).toBe('dark');

    const toggleStyle = screen.getByLabelText('maps.toggleStyle');
    await act(async () => fireEvent.press(toggleStyle));
    expect(mockStatusBarStyles.at(-1)).toBe('light');
    await act(async () => fireEvent.press(toggleStyle));
    expect(mockStatusBarStyles.at(-1)).toBe('light');
    await act(async () => fireEvent.press(toggleStyle));
    expect(mockStatusBarStyles.at(-1)).toBe('dark');

    mockPathname = '/activity/a1';
    mockStatusBarStyles.length = 0;
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(mockStatusBarStyles).toEqual([]);
    mockPathname = '/map';
  });

  /**
   * Scenario: the athlete opens the map over one town and leaves the tab. The
   * next tile pass still put that town first, for a screen nobody has open.
   *
   * Expected behaviour: leaving the tab clears the priority view. Staying on
   * the tab, or entering 3D, which still shows the same ground, does not.
   */
  it('forgets the heatmap priority view when the tab loses focus', async () => {
    mockClearHeatmapView.mockClear();
    const view = await renderRegional();
    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(mockClearHeatmapView).not.toHaveBeenCalled();

    mockPathname = '/activity/a1';
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );

    expect(mockClearHeatmapView).toHaveBeenCalledTimes(1);
  });

  it('takes the terrain view down with the tab too', async () => {
    const view = await renderRegional();
    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.getByTestId('webview', MAP_PAGE)).toBeTruthy();

    mockPathname = '/activity/a1';
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );

    expect(screen.queryByTestId('webview', MAP_PAGE)).toBeNull();
  });

  it('reports attribution changes to the caller', async () => {
    const onAttributionChange = jest.fn();
    await renderRegional({ onAttributionChange });

    expect(onAttributionChange).toHaveBeenCalled();
    expect(screen.queryByText(onAttributionChange.mock.calls[0][0])).toBeNull();
  });

  it('reports its credit alone, with nothing about the base for the caller to theme by', async () => {
    const onAttributionChange = jest.fn();
    await renderRegional({ onAttributionChange });
    expect(onAttributionChange.mock.lastCall).toEqual([expect.any(String)]);

    mockGlobalStyle = 'satellite';
    try {
      const onSatellite = jest.fn();
      await renderRegional({ onAttributionChange: onSatellite });
      expect(onSatellite.mock.lastCall).toEqual([expect.any(String)]);
    } finally {
      mockGlobalStyle = 'light';
    }
  });

  describe('degenerate input', () => {
    const cases: [string, Partial<React.ComponentProps<typeof RegionalMapView>>][] = [
      ['an empty activity list', { activities: [] }],
      [
        'an activity with no start point',
        { activities: [activity('a1', { startPoint: undefined })] },
      ],
      [
        'a non-finite start point',
        {
          activities: [
            activity('a1', { startPoint: [NaN, 7.447] }),
            activity('a2', { startPoint: [46.949, Infinity] }),
          ],
        },
      ],
      [
        'collapsed bounds',
        {
          activities: [
            activity('a1', {
              bounds: [
                [46.948, 7.447],
                [46.948, 7.447],
              ],
            }),
          ],
        },
      ],
    ];

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => renderRegional(props))()).resolves.not.toThrow();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });
  });
});
