/**
 * Scenario: an activity is selected on the global map with the heatmap
 * enabled, then the map switches to 3D.
 *
 * Expected behaviour: the tilted map draws the selected line in the colour the
 * flat one uses, the heatmap colour while the heatmap is shown and the sport
 * colour once it is hidden.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import type { SurfacePatch } from '@/features/maps/lib/mapSurfacePatch';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RegionalMapView } from '@/features/maps/components/RegionalMapView';
import { mapPalette } from '@/theme';
import { sportMarkColour } from '@/features/maps/lib/activityCategories';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

/** Every patch the map page was sent, in order. */
const mockPatches: SurfacePatch[] = [];

jest.mock('@/features/maps/lib/mapSurfacePatch', () => {
  const actual = jest.requireActual('@/features/maps/lib/mapSurfacePatch');
  return {
    ...actual,
    createSurfacePatcher: () => {
      const patcher = actual.createSurfacePatcher();
      return {
        ...patcher,
        next: (specs: unknown) => {
          const result = patcher.next(specs);
          if (result.patch) mockPatches.push(result.patch);
          return result;
        },
      };
    },
  };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
  usePathname: () => '/map',
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
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

function lastRouteColor(): unknown {
  const withLayers = mockPatches.filter((patch) => patch.layers);
  const line = withLayers.at(-1)?.layers?.find((layer) => layer.id === 'selected-route-line');
  return line?.paint?.['line-color'];
}

function lastTerrain(): SurfacePatch['terrain'] {
  return mockPatches.filter((patch) => patch.terrain !== undefined).at(-1)?.terrain;
}

describe('RegionalMapView 3D selected line colour', () => {
  it('follows the heatmap switch the 2D line follows', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RegionalMapView activities={[RIDE]} selectActivityId="a1" />
      </SafeAreaProvider>
    );
    await fireEvent(
      screen.getByTestId('maplibre-map', { includeHiddenElements: true }),
      'message',
      {
        nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) },
      }
    );
    await fireEvent.press(screen.getByTestId('map-toggle-3d'));
    expect(lastTerrain()).not.toBeNull();
    expect(lastRouteColor()).toBe(mapPalette('light').ink);

    await fireEvent.press(screen.getByTestId('map-layers'));
    await fireEvent.press(screen.getByTestId('map-toggle-heatmap'));
    expect(lastRouteColor()).toBe(sportMarkColour('Ride', false));
  });
});
