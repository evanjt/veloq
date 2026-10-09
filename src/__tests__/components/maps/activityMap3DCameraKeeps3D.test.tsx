/**
 * Scenario: the athlete moves the 3D camera on an activity and leaves 3D, which
 * saves that angle for the activity's card.
 *
 * Expected behaviour: the activity stays a 3D render, drawn from the saved
 * angle, so the card the save announces shows it. Undo puts back both the mode
 * and the angle it had. Leaving 3D without moving the camera still turns 3D off.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { resolveTerrain3D } from '@/features/maps/lib/cameraAngle';
import {
  forgetCameraOverrides,
  getCameraOverride,
  setCameraOverride,
} from '@/features/maps/lib/storage/terrainCameraOverrides';
import { MapPreferencesProvider, useMapPreferences } from '@/features/settings';
import { useActivityMapChoices } from '@/features/activity/hooks/useActivityMapChoices';
import type { LatLng } from '@/shared/geo/polyline';

interface Page {
  onMessage: (event: { nativeEvent: { data: string } }) => void;
}

const mockPages = new Map<string, Page>();

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { testID?: string; onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<unknown>
) {
  mockPages.set(props.testID ?? 'webview', { onMessage: props.onMessage });
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  ...jest.requireActual('@/features/maps/lib/storage/terrainPreviewCache'),
  deleteTerrainPreviewsForActivity: jest.fn(async () => {}),
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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const ACTIVITY_ID = 'ride-42';

const COORDINATES: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  latitude: 46.948 + i * 0.001,
  longitude: 7.447 + i * 0.001,
}));
const LNG_LAT = COORDINATES.map((c) => [c.longitude, c.latitude] as [number, number]);

const OPENING_CAMERA = {
  center: [7.45, 46.95] as [number, number],
  zoom: 13,
  bearing: 0,
  pitch: 60,
};
const ATHLETE_CAMERA = {
  center: [7.452, 46.953] as [number, number],
  zoom: 14.2,
  bearing: 135,
  pitch: 72,
};
const EARLIER_CAMERA = {
  center: [7.449, 46.951] as [number, number],
  zoom: 12.5,
  bearing: 300,
  pitch: 55,
};

let prefs: ReturnType<typeof useMapPreferences>;
let undo: () => void = () => {};

function Screen({
  report,
}: {
  report: (current: ReturnType<typeof useMapPreferences>, undoCapture: () => void) => void;
}) {
  const current = useMapPreferences();
  const choices = useActivityMapChoices(ACTIVITY_ID);
  report(current, choices.undoCameraCapture);
  if (!current.isLoaded) return null;
  return (
    <ActivityMapView
      activityId={ACTIVITY_ID}
      activityType="Ride"
      coordinates={COORDINATES}
      initial3DCamera={OPENING_CAMERA}
      showStyleToggle
      on3DModeChange={choices.on3DModeChange}
      onStyleChange={choices.onStyleChange}
      onCameraCapture={choices.onCameraCapture}
    />
  );
}

const post = (message: Record<string, unknown>) => {
  const page = mockPages.get('webview');
  if (!page) throw new Error('the 3D page did not mount');
  act(() => page.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
};

async function open3D() {
  const view = render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MapPreferencesProvider>
        <Screen
          report={(current, undoCapture) => {
            prefs = current;
            undo = undoCapture;
          }}
        />
      </MapPreferencesProvider>
    </SafeAreaProvider>
  );
  await waitFor(() => expect(prefs.isLoaded).toBe(true));
  post({ type: 'mapReady' });
  return view;
}

async function leave3D(view: Awaited<ReturnType<typeof open3D>>) {
  await act(async () => {
    fireEvent.press(view.getByTestId('activity-map-3d-toggle'));
  });
}

const verdict = () =>
  resolveTerrain3D({
    mode: prefs.getTerrain3DMode('Ride', ACTIVITY_ID),
    coordinates: LNG_LAT,
    altitude: undefined,
    gain: 0,
    distance: 12000,
    override: getCameraOverride(ACTIVITY_ID) ?? null,
  });

describe('saving a 3D camera angle', () => {
  beforeEach(async () => {
    mockPages.clear();
    await forgetCameraOverrides();
  });

  it('keeps the activity a 3D render drawn from the saved angle', async () => {
    const view = await open3D();
    post({ type: 'cameraState', camera: ATHLETE_CAMERA, gesture: true });

    await leave3D(view);

    expect(prefs.getTerrain3DMode('Ride', ACTIVITY_ID)).not.toBe('off');
    expect(verdict()).toEqual({ show3D: true, camera: ATHLETE_CAMERA });
    expect(prefs.getActivityCamera(ACTIVITY_ID)).toEqual(ATHLETE_CAMERA);
  });

  it('turns 3D off when the camera was never moved', async () => {
    const view = await open3D();
    post({ type: 'cameraState', camera: ATHLETE_CAMERA, gesture: false });

    await leave3D(view);

    expect(prefs.getTerrain3DMode('Ride', ACTIVITY_ID)).toBe('off');
    expect(getCameraOverride(ACTIVITY_ID)).toBeUndefined();
  });

  it('undo puts back the mode and the angle the activity had', async () => {
    await setCameraOverride(ACTIVITY_ID, EARLIER_CAMERA);
    const view = await open3D();
    post({ type: 'cameraState', camera: ATHLETE_CAMERA, gesture: true });
    await leave3D(view);

    await act(async () => undo());

    expect(prefs.getActivityOverride(ACTIVITY_ID)?.terrain3D).toBeUndefined();
    expect(prefs.getTerrain3DMode('Ride', ACTIVITY_ID)).toBe('smart');
    expect(getCameraOverride(ACTIVITY_ID)).toEqual(EARLIER_CAMERA);
  });

  it('undo puts back a 3D mode the athlete had chosen before', async () => {
    const view = await open3D();
    await act(async () => {
      await prefs.setActivityOverride(ACTIVITY_ID, { terrain3D: true });
    });
    post({ type: 'cameraState', camera: ATHLETE_CAMERA, gesture: true });
    await leave3D(view);

    await act(async () => undo());

    expect(prefs.getActivityOverride(ACTIVITY_ID)?.terrain3D).toBe(true);
    expect(getCameraOverride(ACTIVITY_ID)).toBeUndefined();
  });

  it('resetting the activity map forgets the saved angle with the mode', async () => {
    const view = await open3D();
    post({ type: 'cameraState', camera: ATHLETE_CAMERA, gesture: true });
    await leave3D(view);

    await act(async () => {
      await prefs.clearActivityOverride(ACTIVITY_ID);
    });

    expect(prefs.hasActivityOverride(ACTIVITY_ID)).toBe(false);
    expect(getCameraOverride(ACTIVITY_ID)).toBeUndefined();
    expect(prefs.getActivityCamera(ACTIVITY_ID)).toBeUndefined();
  });
});
