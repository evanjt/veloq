/**
 * Scenario: opening an activity mounts the detail and creates the map's WebView in the same
 * commit, so on the handset both land in one frame of the tap, and that frame runs past the
 * 100 ms a tap may hold.
 *
 * Expected behaviour: the commit that mounts the map view creates no map page, 2D or 3D, inside a
 * slot or outside one; the page is created two frames on, once the detail's own views have mounted, under the poster where there is
 * one. A view arriving on a slot whose surface is already up creates no page at all, so it draws
 * at once.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  ActivityMapView,
  ACTIVITY_MAP_POSTER_TEST_ID,
} from '@/features/maps/components/ActivityMapView';
import { MapSurfaceSlot } from '@/features/maps/components/MapSurfaceSlot';
import { MapSurface, MAP_SURFACE_TEST_ID } from '@/features/maps/components/MapSurface';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
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

const HIDDEN = { includeHiddenElements: true };
/** The 3D page's WebView carries no testID of its own, so it reads as the mock's fallback. */
const PAGE_3D_TEST_ID = 'webview';
const CAMERA_3D = { center: [7.448, 46.949], zoom: 13, bearing: 0, pitch: 60 } as never;

type HeroProps = Partial<React.ComponentProps<typeof ActivityMapView>>;

function hero(props: HeroProps = {}) {
  return (
    <ActivityMapView activityType="Ride" activityId="a1" coordinates={COORDINATES} {...props} />
  );
}

function withMetrics(children: React.ReactNode) {
  return <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
}

function pages2D() {
  return screen.queryAllByTestId(MAP_SURFACE_TEST_ID, HIDDEN).length;
}

function pages3D() {
  return screen.queryAllByTestId(PAGE_3D_TEST_ID, HIDDEN).length;
}

function nextFrame() {
  act(() => {
    jest.advanceTimersToNextTimer();
  });
}

function settleFrames() {
  nextFrame();
  nextFrame();
}

beforeEach(() => {
  mockCached.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the activity open creates its map page two frames after the mount', () => {
  it('creates no 2D page in the mount commit under a cached poster, and one two frames on', () => {
    mockCached.add('a1-light-false');
    render(withMetrics(hero()));

    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeTruthy();
    expect(pages2D()).toBe(0);

    settleFrames();

    expect(pages2D()).toBe(1);
    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeTruthy();
  });

  it('defers the page the same way with no poster, since the page stays transparent until ready', () => {
    render(withMetrics(hero()));

    expect(pages2D()).toBe(0);

    settleFrames();

    expect(pages2D()).toBe(1);
  });

  it("defers the slot's page too, which the view publishes to rather than mounting", () => {
    mockCached.add('a1-light-false');
    render(withMetrics(<MapSurfaceSlot subject="a1">{hero()}</MapSurfaceSlot>));

    expect(pages2D()).toBe(0);

    settleFrames();

    expect(pages2D()).toBe(1);
  });

  it('creates no 3D page in the mount commit, and one two frames on', () => {
    mockCached.add('a1-light-true');
    render(withMetrics(hero({ initial3DCamera: CAMERA_3D })));

    expect(screen.getByTestId(ACTIVITY_MAP_POSTER_TEST_ID)).toBeTruthy();
    expect(pages3D()).toBe(0);
    expect(pages2D()).toBe(0);

    nextFrame();

    // The detail's own views mount in this frame, so the page waits one more.
    expect(pages3D()).toBe(0);

    nextFrame();

    expect(pages3D()).toBe(1);
    // The poster covers the 3D boot, so no 2D page is built behind it.
    expect(pages2D()).toBe(0);
  });

  it('creates nothing further on a later render of the same view', () => {
    mockCached.add('a1-light-false');
    const { rerender } = render(withMetrics(hero()));
    settleFrames();

    rerender(withMetrics(hero({ highlightIndex: 2 })));
    settleFrames();

    expect(pages2D()).toBe(1);
  });

  it('keeps the page if the view goes before its frame comes, and creates none after', () => {
    const { rerender } = render(withMetrics(hero()));

    rerender(withMetrics(null));
    settleFrames();

    expect(pages2D()).toBe(0);
  });

  it('publishes at once onto a slot whose surface is already up', () => {
    const slotted = (id: string) => (
      <MapSurfaceSlot subject={id}>
        <ActivityMapView key={id} activityType="Ride" activityId={id} coordinates={COORDINATES} />
      </MapSurfaceSlot>
    );
    const { rerender } = render(withMetrics(slotted('a1')));
    settleFrames();
    expect(pages2D()).toBe(1);

    rerender(withMetrics(slotted('a2')));

    // The second subject draws on the surface the first left up, in its own mount commit.
    expect(pages2D()).toBe(1);
    expect(screen.UNSAFE_getByType(MapSurface).props.layers.length).toBeGreaterThan(0);
  });
});
