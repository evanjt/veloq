/**
 * Scenario: an activity is selected on the global map with the heatmap
 * enabled, then the map switches to 3D.
 *
 * Expected behaviour: the 3D surface receives the same line colour the 2D
 * surface uses, the heatmap colour while the heatmap is shown and the sport
 * colour once it is hidden.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/features/maps/components/RegionalMapView';
import { HEATMAP_ROUTE_COLOR } from '@/features/maps/components/regional';
import { getActivityTypeConfig } from '@/features/maps/lib/activityCategories';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const mockTerrainProps = jest.fn();

jest.mock('@/features/maps/components/Map3DWebView', () => {
  const { forwardRef } = require('react');
  return {
    Map3DWebView: forwardRef(function TerrainStub(props: { routeColor?: string }, _ref: unknown) {
      mockTerrainProps(props);
      return null;
    }),
  };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
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

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isHeatmapEnabled: () => true,
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getGpsTrack: () => 'encoded',
    subscribe: () => () => {},
    startFetchAndStore: () => 0,
  }),
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

const RIDE: ActivityBoundsItem = {
  id: 'a1',
  bounds: [
    [46.94, 7.44],
    [46.96, 7.46],
  ],
  type: 'Ride',
  name: 'Ride a1',
  date: '2026-01-15T10:00:00Z',
  distance: 42_000,
  duration: 5400,
  startPoint: [46.948, 7.447],
};

function lastRouteColor(): string | undefined {
  const calls = mockTerrainProps.mock.calls;
  return calls[calls.length - 1][0].routeColor;
}

describe('RegionalMapView 3D selected line colour', () => {
  it('follows the heatmap switch the 2D line follows', () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[RIDE]} selectActivityId="a1" />
      </SafeAreaProvider>
    );
    fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(lastRouteColor()).toBe(HEATMAP_ROUTE_COLOR);

    fireEvent.press(screen.getByTestId('map-toggle-heatmap'));
    expect(lastRouteColor()).toBe(getActivityTypeConfig('Ride').color);
  });
});
