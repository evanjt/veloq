/**
 * Scenario: the athlete leaves 3D, by the toggle or because the terrain failed.
 *
 * Expected behaviour: a camera is handed to the caller only when a gesture
 * moved it. The page's own resize and fit post a camera too, and a failed page
 * never carries an athlete's angle.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import type { LatLng } from '@/shared/geo/polyline';

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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));

const CAMERA = { center: [7.45, 46.95] as [number, number], zoom: 13, bearing: 0, pitch: 60 };

const post = (message: Record<string, unknown>) => {
  const page = mockPages.get('webview');
  if (!page) throw new Error('the 3D page did not mount');
  act(() => page.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
};

const open3D = (onCameraCapture: jest.Mock) => {
  const view = render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ActivityMapView
        activityType="Ride"
        coordinates={COORDINATES}
        initial3DCamera={CAMERA}
        showStyleToggle
        onCameraCapture={onCameraCapture}
      />
    </SafeAreaProvider>
  );
  post({ type: 'mapReady' });
  return view;
};

describe('leaving the 3D view', () => {
  it('captures nothing when the camera only moved by itself', () => {
    const capture = jest.fn();
    const view = open3D(capture);
    post({ type: 'cameraState', camera: CAMERA, gesture: false });

    fireEvent(view.getByTestId('activity-map-3d-toggle'), 'pressIn');

    expect(capture).not.toHaveBeenCalled();
  });

  it('captures the camera a gesture left', () => {
    const capture = jest.fn();
    const view = open3D(capture);
    post({ type: 'cameraState', camera: CAMERA, gesture: true });

    fireEvent(view.getByTestId('activity-map-3d-toggle'), 'pressIn');

    expect(capture).toHaveBeenCalledWith(CAMERA);
  });

  it('captures nothing when the terrain failed after a gesture', () => {
    const capture = jest.fn();
    open3D(capture);
    post({ type: 'cameraState', camera: CAMERA, gesture: true });
    post({ type: 'terrainUnavailable', reason: 'no-tiles' });

    expect(capture).not.toHaveBeenCalled();
  });

  it('captures nothing when the page failed after a gesture', () => {
    const capture = jest.fn();
    open3D(capture);
    post({ type: 'cameraState', camera: CAMERA, gesture: true });
    post({ type: 'mapFailed' });

    expect(capture).not.toHaveBeenCalled();
  });
});
