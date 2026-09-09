/**
 * Scenario: the activity map holds its 2D layer at `opacity: 0` until the
 * surface reports itself ready. A surface that can never load leaves that gate
 * shut, so the athlete's track is invisible with nothing to explain it.
 *
 * Expected behaviour: a failed surface opens the gate and shows the
 * basemap-unavailable state. A surface that loads late opens it and clears the
 * state, and a healthy load never shows it.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ActivityMapView,
  ACTIVITY_MAP_2D_LAYER_TEST_ID,
} from '@/features/maps/components/ActivityMapView';
import {
  MAP_SURFACE_TEST_ID,
  MAP_SURFACE_UNAVAILABLE_TEST_ID,
} from '@/features/maps/components/MapSurface';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
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

const COORDINATES: LatLng[] = [
  { latitude: 46.948, longitude: 7.447 },
  { latitude: 46.949, longitude: 7.448 },
  { latitude: 46.95, longitude: 7.449 },
];

function renderActivityMap() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" coordinates={COORDINATES} />
    </SafeAreaProvider>
  );
}

const post = (message: object) =>
  fireEvent(screen.getByTestId(MAP_SURFACE_TEST_ID), 'message', {
    nativeEvent: { data: JSON.stringify(message) },
  });

const layerOpacity = () => {
  const style = screen.getByTestId(ACTIVITY_MAP_2D_LAYER_TEST_ID).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  return flat.opacity;
};

describe('activity map with an unavailable basemap', () => {
  it('keeps the 2D layer hidden until the surface says something', () => {
    renderActivityMap();

    expect(layerOpacity()).toBe(0);
    expect(screen.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
  });

  it('reveals the layer and the unavailable state when the surface fails', () => {
    renderActivityMap();

    post({ type: 'mapFailed', reason: 'ready timeout' });

    expect(layerOpacity()).toBe(1);
    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
  });

  it('reveals the layer with no unavailable state on a healthy load', () => {
    renderActivityMap();

    post({ type: 'mapReady' });

    expect(layerOpacity()).toBe(1);
    expect(screen.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
  });

  it('clears the unavailable state when the load arrives after the failure', () => {
    renderActivityMap();

    post({ type: 'mapFailed', reason: 'ready timeout' });
    post({ type: 'mapReady' });

    expect(layerOpacity()).toBe(1);
    expect(screen.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
  });
});
