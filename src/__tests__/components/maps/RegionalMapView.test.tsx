/**
 * Scenario: the regional map is rendered over a list of activity bounds that
 * may be empty, partly invalid, or missing their start points.
 *
 * Expected behaviour: it mounts, exposes its overlay toggles and the fit-all
 * control, and the toggles stay pressable without a GL context.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/features/maps/components/RegionalMapView';
import { decodeCoords } from 'veloqrs';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const mockClearHeatmapView = jest.fn();

jest.mock('@/features/maps/lib/heatmapGeneration', () => ({
  ...jest.requireActual('@/features/maps/lib/heatmapGeneration'),
  clearHeatmapView: () => mockClearHeatmapView(),
}));

let mockPathname = '/map';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname,
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getGlobalMapStyle: () => 'light',
    setGlobalMapStyle: jest.fn(),
    getStyleForActivity: () => 'light',
  }),
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
  getEngine: () => ({ getGpsTrack: () => 'encoded' }),
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
  it('opens the popup for the section a link names', () => {
    renderRegional({ selectSectionId: 'sec-1' });

    expect(mockSectionDetail).toHaveBeenCalledWith('sec-1');
    expect(screen.getByTestId('section-popup')).toBeTruthy();
  });

  it('opens no section popup without a section in the link', () => {
    renderRegional();

    expect(screen.queryByTestId('section-popup')).toBeNull();
  });

  beforeEach(() => {
    (decodeCoords as jest.Mock).mockReturnValue([{ latitude: 46.95, longitude: 7.45 }]);
    mockPathname = '/map';
  });

  it('mounts a map with activity overlays', () => {
    renderRegional();

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.getByTestId('map-toggle-activities')).toBeTruthy();
  });

  it('offers fit-all once there is at least one activity', () => {
    renderRegional();

    expect(screen.getByTestId('map-fit-all')).toBeTruthy();
    expect(() => fireEvent.press(screen.getByTestId('map-fit-all'))).not.toThrow();
  });

  it('withholds fit-all when there is nothing to fit', () => {
    renderRegional({ activities: [] });

    expect(screen.queryByTestId('map-fit-all')).toBeNull();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('keeps the overlay toggles pressable', () => {
    renderRegional();

    for (const id of ['map-toggle-activities', 'map-toggle-heatmap']) {
      expect(() => fireEvent.press(screen.getByTestId(id))).not.toThrow();
      expect(() => fireEvent.press(screen.getByTestId(id))).not.toThrow();
    }

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  /**
   * Scenario: the markers are drawn into the map canvas, so no automation can
   * tap one. A deep link names the activity to open instead.
   *
   * Expected behaviour: the named activity's popup shows with its actions, the
   * close button dismisses it, and an unknown id opens nothing.
   */
  it('opens the popup for the activity a deep link names, and closes it', () => {
    renderRegional({ selectActivityId: 'a2' });

    expect(screen.getByTestId('activity-popup')).toBeTruthy();
    expect(screen.getByText('Ride a2')).toBeTruthy();
    expect(screen.getByTestId('activity-popup-view-details')).toBeTruthy();

    fireEvent.press(screen.getByTestId('activity-popup-close'));
    expect(screen.queryByTestId('activity-popup')).toBeNull();
  });

  it('opens no popup for an activity that is not on the map', () => {
    renderRegional({ selectActivityId: 'missing' });

    expect(screen.queryByTestId('activity-popup')).toBeNull();
  });

  it('opens the popup once the named activity arrives', () => {
    const view = renderRegional({ activities: [], selectActivityId: 'a1' });
    expect(screen.queryByTestId('activity-popup')).toBeNull();

    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1')]} selectActivityId="a1" />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId('activity-popup')).toBeTruthy();
  });

  it('swaps in the terrain view when 3D is enabled', () => {
    renderRegional();

    expect(screen.queryByTestId('webview')).toBeNull();

    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.getByTestId('webview')).toBeTruthy();

    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('tears the surface down when the tab loses focus and rebuilds it on return', () => {
    const view = renderRegional();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();

    mockPathname = '/activity/a1';
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(screen.queryByTestId('maplibre-map')).toBeNull();

    mockPathname = '/map';
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  /**
   * Scenario: the athlete opens the map over one town and leaves the tab. The
   * next tile pass still put that town first, for a screen nobody has open.
   *
   * Expected behaviour: leaving the tab clears the priority view. Staying on
   * the tab, or entering 3D, which still shows the same ground, does not.
   */
  it('forgets the heatmap priority view when the tab loses focus', () => {
    mockClearHeatmapView.mockClear();
    const view = renderRegional();
    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );
    expect(mockClearHeatmapView).not.toHaveBeenCalled();

    mockPathname = '/activity/a1';
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );

    expect(mockClearHeatmapView).toHaveBeenCalledTimes(1);
  });

  it('takes the terrain view down with the tab too', () => {
    const view = renderRegional();
    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.getByTestId('webview')).toBeTruthy();

    mockPathname = '/activity/a1';
    view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[activity('a1'), activity('a2')]} />
      </SafeAreaProvider>
    );

    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('reports attribution changes to the caller', () => {
    const onAttributionChange = jest.fn();
    renderRegional({ onAttributionChange });

    expect(onAttributionChange).toHaveBeenCalled();
    expect(screen.queryByText(onAttributionChange.mock.calls[0][0])).toBeNull();
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

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderRegional(props)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});
