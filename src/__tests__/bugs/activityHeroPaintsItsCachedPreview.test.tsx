/**
 * Scenario: the feed card just tapped was painted from a PNG of that activity,
 * in the same style and the same 3D camera, already on disk. The hero opened
 * on a dark rectangle with a spinner for the 1.4 s to 4.3 s the page takes to
 * boot, then showed the same picture.
 *
 * Expected behaviour: the hero paints the cached preview immediately and the
 * surface fades in over it when it reports ready. The spinner is for a hero
 * with no snapshot.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ActivityMapView,
  ACTIVITY_MAP_POSTER_TEST_ID,
} from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

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
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const mockCached = new Set<string>();

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}-${style}-${is3D}`),
  getTerrainPreviewUri: (id: string, style: string, is3D: boolean) =>
    `file:///previews/${id}-${style}-${is3D}.jpg`,
  isTerrainPreviewDowngraded: () => false,
  onTerrainCacheReady: () => () => {},
  isTerrainCacheInitialized: () => true,
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

function renderHero(props: Partial<React.ComponentProps<typeof ActivityMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView activityType="Ride" activityId="a1" coordinates={COORDINATES} {...props} />
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  mockCached.clear();
});

describe('the hero paints the snapshot the feed already drew', () => {
  it('shows the cached preview before the surface reports ready', () => {
    mockCached.add('a1-light-false');

    renderHero();

    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID).props.source).toEqual({
      uri: 'file:///previews/a1-light-false.jpg',
    });
  });

  it('shows nothing of the sort when no snapshot was ever written', () => {
    renderHero();

    expect(screen.queryByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeNull();
  });

  it('needs an activity id to find one, and does not guess', () => {
    mockCached.add('a1-light-false');

    renderHero({ activityId: undefined });

    expect(screen.queryByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeNull();
  });
});
