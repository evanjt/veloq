/**
 * Scenario: the regional map is rendered over a list of activity bounds that
 * may be empty, partly invalid, or missing GPS tracks.
 *
 * Expected behaviour: it mounts, exposes its overlay toggles and the fit-all
 * control, and the toggles stay pressable without a GL context.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/features/maps/components/RegionalMapView';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
  usePathname: () => '/map',
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getGlobalMapStyle: () => 'light',
    setGlobalMapStyle: jest.fn(),
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/features/routes/hooks', () => ({
  useEngineSections: () => ({ sections: [], isLoading: false }),
  useEngineSectionCount: () => 0,
  useRouteSignatures: () => ({}),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isHeatmapEnabled: () => true,
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
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
    latlngs: [
      [46.948, 7.447],
      [46.949, 7.448],
      [46.95, 7.449],
    ],
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

  it('swaps in the terrain view when 3D is enabled', () => {
    renderRegional();

    expect(screen.queryByTestId('webview')).toBeNull();

    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.getByTestId('webview')).toBeTruthy();

    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('reports attribution changes to the caller', () => {
    const onAttributionChange = jest.fn();
    renderRegional({ onAttributionChange });

    expect(onAttributionChange).toHaveBeenCalled();
  });

  describe('degenerate input', () => {
    const cases: [string, Partial<React.ComponentProps<typeof RegionalMapView>>][] = [
      ['an empty activity list', { activities: [] }],
      ['an activity with no GPS track', { activities: [activity('a1', { latlngs: undefined })] }],
      ['an activity with an empty GPS track', { activities: [activity('a1', { latlngs: [] })] }],
      [
        'an activity with a single GPS point',
        { activities: [activity('a1', { latlngs: [[46.948, 7.447]] })] },
      ],
      [
        'non-finite GPS points',
        {
          activities: [
            activity('a1', {
              latlngs: [
                [NaN, 7.447],
                [46.949, Infinity],
              ],
            }),
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
      ['attribution turned off', { showAttribution: false }],
    ];

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderRegional(props)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});
