/**
 * Scenario: the athlete leaves 3D, by the toggle or because the terrain failed.
 *
 * Expected behaviour: a camera is handed to the caller only when a gesture
 * moved it. The page's own resize, fit and tilt report a camera too, and a page
 * with no elevation tiles never carries an athlete's angle. Turning 3D on again
 * flies to the angle that was kept.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';
import { renderStaged } from '../../__shared__/stagedRender';

interface Page {
  html: string[];
  injected: string[];
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

const mockPages = new Map<string, Page>();
const mockPatches: { patch: Record<string, unknown> | null; serialised: number }[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    testID?: string;
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    source: { html: string };
  },
  ref: React.Ref<unknown>
) {
  const id = props.testID ?? 'webview';
  const page = mockPages.get(id) ?? { html: [], injected: [], onMessage: props.onMessage };
  mockPages.set(id, page);
  page.onMessage = props.onMessage;
  if (page.html[page.html.length - 1] !== props.source.html) page.html.push(props.source.html);
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

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const CAMERA = { center: [7.45, 46.95] as [number, number], zoom: 13, bearing: 0, pitch: 60 };

const post = async (message: Record<string, unknown>) => {
  const page = mockPages.get('maplibre-map');
  if (!page) throw new Error('the map page did not mount');
  await act(() => page.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
};

/** The page settling at `camera`, by a gesture or by its own move. */
const settleAt = (camera: typeof CAMERA, isUserInteraction: boolean) =>
  post({
    type: 'regionDidChange',
    ...camera,
    bounds: { sw: [7.4, 46.9], ne: [7.5, 47] },
    isUserInteraction,
  });

const open3D = async (onCameraCapture: jest.Mock) => {
  const view = await renderStaged(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        coordinates={COORDINATES}
        height={800}
        initial3DCamera={CAMERA}
        showStyleToggle
        onCameraCapture={onCameraCapture}
      />
    </SafeAreaProvider>
  );
  await post({ type: 'mapReady' });
  return view;
};

describe('leaving the 3D view', () => {
  it('captures nothing when the camera only moved by itself', async () => {
    const capture = jest.fn();
    const view = await open3D(capture);
    await settleAt(CAMERA, false);

    await fireEvent.press(view.getByTestId('activity-map-3d-toggle'));

    expect(capture).not.toHaveBeenCalled();
  });

  it('captures the camera a gesture left', async () => {
    const capture = jest.fn();
    const view = await open3D(capture);
    await settleAt(CAMERA, true);

    await fireEvent.press(view.getByTestId('activity-map-3d-toggle'));

    expect(capture).toHaveBeenCalledWith(CAMERA);
  });

  it('captures nothing when the terrain failed after a gesture', async () => {
    const capture = jest.fn();
    await open3D(capture);
    await settleAt(CAMERA, true);
    await post({ type: 'terrainUnavailable', reason: 'no-tiles' });

    expect(capture).not.toHaveBeenCalled();
  });

  it('captures the last gesture, not a move the page made after it', async () => {
    const capture = jest.fn();
    const view = await open3D(capture);
    await settleAt(CAMERA, true);
    await settleAt({ ...CAMERA, bearing: 90 }, false);

    await fireEvent.press(view.getByTestId('activity-map-3d-toggle'));

    expect(capture).toHaveBeenCalledWith(CAMERA);
  });

  it('flies to the kept angle when 3D is turned on again', async () => {
    const capture = jest.fn();
    const view = await open3D(capture);
    const kept = { ...CAMERA, center: [7.4567, 46.9876] as [number, number], bearing: 135 };
    await settleAt(kept, true);
    await fireEvent.press(view.getByTestId('activity-map-3d-toggle'));
    const page = mockPages.get('maplibre-map')!;
    page.injected.length = 0;

    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActivityMapView
          activityType="Ride"
          coordinates={COORDINATES}
          height={800}
          initial3DCamera={kept}
          showStyleToggle
          onCameraCapture={capture}
        />
      </SafeAreaProvider>
    );
    await fireEvent.press(view.getByTestId('activity-map-3d-toggle'));

    const moves = page.injected.filter((script) => script.includes('7.4567'));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toContain('135');
  });
});
