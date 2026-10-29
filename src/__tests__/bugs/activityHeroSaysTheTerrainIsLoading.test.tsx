/**
 * Scenario: the hero opens in 3D over the feed's cached snapshot. The terrain page takes
 * seconds to boot, and the still picture reads as a live map that ignores touch.
 *
 * Expected behaviour: a loading cue stands over the snapshot while the 3D page boots, and it
 * goes the moment the page is ready or fails.
 */

import React from 'react';
import { View } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ActivityMapView,
  ACTIVITY_MAP_LOADING_CUE_TEST_ID,
  ACTIVITY_MAP_POSTER_TEST_ID,
} from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';

interface PageProps {
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  onError?: () => void;
}

let page: PageProps | null = null;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: PageProps,
  ref: React.Ref<unknown>
) {
  page = props;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => true,
  getTerrainPreviewUri: (id: string) => `file:///previews/${id}.jpg`,
  isTerrainPreviewDowngraded: () => false,
  onTerrainCacheReady: () => () => {},
  isTerrainCacheInitialised: () => true,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = [
  { latitude: 46.948, longitude: 7.447 },
  { latitude: 46.949, longitude: 7.448 },
  { latitude: 46.95, longitude: 7.449 },
  { latitude: 46.951, longitude: 7.45 },
];

async function openIn3D() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        activityId="a1"
        coordinates={COORDINATES}
        initial3DCamera={{ center: [7.448, 46.95], zoom: 13, bearing: 0, pitch: 60 }}
      />
    </SafeAreaProvider>
  );
  await waitFor(() => expect(page).not.toBeNull());
}

beforeEach(() => {
  page = null;
});

describe('the hero says the terrain is loading', () => {
  it('shows a cue over the snapshot while the 3D page boots', async () => {
    await openIn3D();

    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeTruthy();
    expect(screen.getByTestId(ACTIVITY_MAP_LOADING_CUE_TEST_ID)).toBeTruthy();
  });

  it('removes the cue with the snapshot when the page is ready', async () => {
    await openIn3D();

    await act(() =>
      page!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } })
    );

    expect(screen.queryByTestId(ACTIVITY_MAP_LOADING_CUE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeNull();
  });

  it('removes the cue when the page fails to load', async () => {
    await openIn3D();

    await act(() => page!.onError?.());

    expect(screen.queryByTestId(ACTIVITY_MAP_LOADING_CUE_TEST_ID)).toBeNull();
  });
});
