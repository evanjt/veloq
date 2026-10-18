/**
 * Scenario: the route detail hero map is rendered for route groups whose
 * signature may be missing, empty or partly invalid.
 *
 * Expected behaviour: a usable route renders `route-map-container` and can open
 * fullscreen, and a route with nothing to draw falls back to the placeholder
 * instead of throwing.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import type { RoutePoint } from '@/types';
import { MAP_ATTRIBUTIONS } from '@/features/maps/components/mapStyles';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
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

const POINTS: RoutePoint[] = [
  { lat: 46.948, lng: 7.447 },
  { lat: 46.949, lng: 7.448 },
  { lat: 46.95, lng: 7.449 },
  { lat: 46.951, lng: 7.45 },
];

function routeGroup(signature: { points: RoutePoint[]; distance: number } | null | undefined) {
  return {
    id: 'route-1',
    name: 'Morning loop',
    signature,
    activityIds: ['a1', 'a2'],
    activityCount: 2,
    type: 'Ride' as const,
  };
}

function renderRoute(props: Partial<React.ComponentProps<typeof RouteMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RouteMapView routeGroup={routeGroup({ points: POINTS, distance: 4200 })} {...props} />
    </SafeAreaProvider>
  );
}

describe('RouteMapView', () => {
  it('mounts the route container and a map', async () => {
    await renderRoute();

    expect(screen.getByTestId('route-map-container')).toBeTruthy();
    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('opens fullscreen on tap when fullscreen is enabled', async () => {
    await renderRoute({ enableFullscreen: true });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    await fireEvent.press(screen.getByTestId('route-map-container'));

    expect(screen.getByTestId('map-fullscreen-close')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('calls the press handler instead of opening fullscreen', async () => {
    const onPress = jest.fn();
    await renderRoute({ onPress });

    await fireEvent.press(screen.getByTestId('route-map-container'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('renders highlighted traces from activity signatures', async () => {
    await renderRoute({
      activitySignatures: {
        a1: { points: POINTS },
        a2: { points: POINTS.slice(0, 3) },
      },
      highlightedActivityId: 'a1',
    });

    expect(screen.getByTestId('route-map-container')).toBeTruthy();
  });

  it('accepts a highlighted lap that is shorter than the route', async () => {
    await renderRoute({
      activitySignatures: { a1: { points: POINTS } },
      highlightedLapPoints: POINTS.slice(1, 3),
    });

    expect(screen.getByTestId('route-map-container')).toBeTruthy();
  });

  it("sits the credit above the sheet covering the map's foot", async () => {
    await renderRoute({ interactive: true, coveredBottom: 240 });

    expect(StyleSheet.flatten(screen.getByTestId('map-attribution').props.style).bottom).toBe(240);
  });

  describe('degenerate input', () => {
    it('falls back to a placeholder when the signature is missing', async () => {
      await renderRoute({ routeGroup: routeGroup(null) });

      expect(screen.queryByTestId('route-map-container')).toBeNull();
      expect(screen.queryByTestId('maplibre-map', MAP_PAGE)).toBeNull();
    });

    it('falls back to a placeholder for an empty point list', async () => {
      await renderRoute({ routeGroup: routeGroup({ points: [], distance: 0 }) });

      expect(screen.queryByTestId('route-map-container')).toBeNull();
    });

    it('renders a single-point route without a line', async () => {
      await expect(
        (async () =>
          renderRoute({ routeGroup: routeGroup({ points: [POINTS[0]], distance: 0 }) }))()
      ).resolves.not.toThrow();
    });

    it('drops non-finite points rather than throwing', async () => {
      const dirty: RoutePoint[] = [
        { lat: NaN, lng: 7.447 },
        { lat: 46.949, lng: Infinity },
        ...POINTS,
      ];

      await expect(
        (async () => renderRoute({ routeGroup: routeGroup({ points: dirty, distance: 1 }) }))()
      ).resolves.not.toThrow();
      expect(screen.getByTestId('route-map-container')).toBeTruthy();
    });

    it('ignores activity signatures that are too short to draw', async () => {
      await expect(
        (async () =>
          renderRoute({
            activitySignatures: { a1: { points: [POINTS[0]] }, a2: { points: [] } },
            highlightedActivityId: 'a1',
          }))()
      ).resolves.not.toThrow();
      expect(screen.getByTestId('route-map-container')).toBeTruthy();
    });

    it('ignores a highlighted activity that has no trace', async () => {
      await expect(
        (async () => renderRoute({ highlightedActivityId: 'missing' }))()
      ).resolves.not.toThrow();
      expect(screen.getByTestId('route-map-container')).toBeTruthy();
    });
  });

  it('credits the basemap inline, outside the fullscreen view', async () => {
    await renderRoute({ enableFullscreen: true });

    expect(screen.getByTestId('map-attribution-text').props.children).toBe(MAP_ATTRIBUTIONS.light);
  });
});
