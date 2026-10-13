/**
 * Scenario: the athlete presses the locate control on the inline activity map
 * twice in a row, with location permission granted.
 *
 * Expected behaviour: the second press reuses the first fix, the 2D surface is
 * eased onto it at the regional zoom, and the surface carries a location dot
 * at the fix. The dot's source is mounted before any fix, empty.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { LOCATE_EASE_MS, LOCATE_ZOOM } from '@/features/maps/hooks/useLocateUser';
import type { LatLng } from '@/shared/geo/polyline';

interface Page {
  injected: string[];
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

const mockPages = new Map<string, Page>();
const mockPatches: { patch: Record<string, unknown> | null }[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    testID?: string;
    onMessage: (event: { nativeEvent: { data: string } }) => void;
  },
  ref: React.Ref<unknown>
) {
  const id = props.testID ?? 'webview';
  const page = mockPages.get(id) ?? { injected: [], onMessage: props.onMessage };
  mockPages.set(id, page);
  page.onMessage = props.onMessage;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => page.injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

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
          mockPatches.push(result);
          return result;
        },
      };
    },
  };
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

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
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = Array.from({ length: 4 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const FIX: [number, number] = [7.5, 46.5];

const userLocationData = () =>
  mockPatches
    .map(
      (p) =>
        (p.patch?.sources as Record<string, { data?: GeoJSON.FeatureCollection }>)?.[
          'user-location'
        ]
    )
    .filter(Boolean)
    .map((source) => source.data);

beforeEach(() => {
  mockPages.clear();
  mockPatches.length = 0;
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'undetermined',
    canAskAgain: true,
  });
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
  });
  (Location.getCurrentPositionAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue({ coords: { longitude: FIX[0], latitude: FIX[1] } });
});

describe('locating the user on the inline activity map', () => {
  const mount = async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle />
      </SafeAreaProvider>
    );
    const page = mockPages.get('maplibre-map');
    if (!page) throw new Error('the 2D surface did not mount');
    await act(() =>
      page.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } })
    );
    return page;
  };

  const press = async () => {
    await act(async () => {
      await fireEvent.press(screen.getByTestId('activity-map-location'));
    });
  };

  it('asks for one fix across two presses', async () => {
    await mount();
    await press();
    await press();

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('eases the 2D surface onto the fix at the shared zoom', async () => {
    const page = await mount();
    await press();

    const eased = page.injected.filter((s) => s.includes('easeTo'));
    expect(eased).toHaveLength(1);
    expect(eased[0]).toContain(`"center":[${FIX[0]},${FIX[1]}]`);
    expect(eased[0]).toContain(`"zoom":${LOCATE_ZOOM}`);
    expect(eased[0]).toContain(`(window._veloqReduceMotion ? 0 : ${LOCATE_EASE_MS})`);
  });

  it('mounts the dot source empty, then holds a point at the fix', async () => {
    await mount();
    expect(userLocationData().at(-1)).toEqual({ type: 'FeatureCollection', features: [] });

    await press();

    const dot = userLocationData().at(-1);
    expect(dot?.features).toHaveLength(1);
    expect(dot?.features[0].geometry).toEqual({ type: 'Point', coordinates: FIX });
  });

  it('draws the dot layers last and shows the button active while a dot is held', async () => {
    await mount();
    expect(screen.getByTestId('activity-map-location').props.accessibilityState).toMatchObject({
      selected: false,
    });

    await press();

    expect(screen.getByTestId('activity-map-location').props.accessibilityState).toMatchObject({
      selected: true,
    });
    const layerSets = mockPatches
      .map((p) => p.patch?.layers as { id: string }[] | undefined)
      .filter(Boolean) as { id: string }[][];
    const ids = layerSets.at(-1)?.map((l) => l.id) ?? [];
    expect(ids.slice(-2)).toEqual(['user-location-outer', 'user-location-inner']);
  });

  it('leaves the camera and the dot alone when permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
    });
    const page = await mount();
    await press();

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(page.injected.filter((s) => s.includes('easeTo'))).toEqual([]);
    expect(userLocationData().at(-1)?.features).toEqual([]);
  });
});
