/**
 * Scenario: fit all, locate and the popup zoom move the camera. On the map tab
 * 3D is the one surface tilted over terrain; a detail map's 3D is its own page.
 *
 * Expected behaviour: on the map tab each of them moves the one surface, and a
 * detail map's 3D ref turns the move into a page script.
 */

import { renderHook, render, act } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';
import * as Location from 'expo-location';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { Map3DWebView, type Map3DWebViewRef } from '@/features/maps/components/Map3DWebView';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'undetermined', canAskAgain: true }),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 7.5, latitude: 46.5 } })),
  Accuracy: { Balanced: 3 },
}));

function surface() {
  return { fitBounds: jest.fn(), setCamera: jest.fn(), resetOrientation: jest.fn() };
}

const activities = [
  {
    id: 'a',
    bounds: [
      [46.0, 7.0],
      [46.2, 7.2],
    ],
  },
  {
    id: 'b',
    bounds: [
      [46.5, 7.4],
      [46.9, 7.8],
    ],
  },
];

async function mountHandlers(selected: unknown = null) {
  const map = surface();
  const rendered = await renderHook(() =>
    useMapHandlers({
      activities,
      selected,
      setSelected: jest.fn(),
      setSelectedSectionId: jest.fn(),
      chooseSection: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRouteId: jest.fn(),
      userLocation: null,
      setUserLocation: jest.fn(),
      setLocationLoading: jest.fn(),
      currentZoomRef: { current: 8 },
      currentCenterRef: { current: [7, 46] },
      surfaceRef: { current: map } as unknown as React.RefObject<MapSurfaceRef | null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: 8 },
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    } as never)
  );
  return { rendered, map };
}

describe('camera handlers on the map tab', () => {
  it('fit all fits every activity on the surface', async () => {
    const { rendered, map } = await mountHandlers();
    await act(() => rendered.result.current.handleFitAll());
    expect(map.fitBounds).toHaveBeenCalledWith(
      { sw: [7.0, 46.0], ne: [7.8, 46.9] },
      expect.anything(),
      500
    );
  });

  it('the popup zoom fits the selected activity on the surface', async () => {
    const { rendered, map } = await mountHandlers({ activity: activities[1] });
    await act(() => rendered.result.current.handleZoomToActivity());
    expect(map.fitBounds).toHaveBeenCalledWith(
      { sw: [7.4, 46.5], ne: [7.8, 46.9] },
      expect.anything(),
      expect.any(Number)
    );
  });

  it('locate centres the surface on the fix', async () => {
    const { rendered, map } = await mountHandlers();
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    expect(map.setCamera).toHaveBeenCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
  });

  it('the compass reset goes to the surface', async () => {
    const { rendered, map } = await mountHandlers();
    await act(() => rendered.result.current.resetOrientation());
    expect(map.resetOrientation).toHaveBeenCalledTimes(1);
  });
});

describe('Map3DWebViewRef camera commands', () => {
  async function mountPage() {
    const ref = React.createRef<Map3DWebViewRef>();
    const view = await render(
      <Map3DWebView ref={ref} coordinates={[[7.4, 46.9]]} mapStyle="light" />
    );
    await act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    injected.length = 0;
    return { ref, view };
  }

  it('fitBounds injects a fit of the box with its padding and duration', async () => {
    const { ref, view } = await mountPage();
    await act(() => ref.current?.fitBounds({ sw: [7.0, 46.0], ne: [7.8, 46.9] }, 40, 500));
    const script = injected.join('\n');
    expect(script).toContain('window.map.fitBounds([[7,46],[7.8,46.9]]');
    expect(script).toContain('duration: (window._veloqReduceMotion ? 0 : 500)');
    await view.unmount();
  });

  it('setCamera eases to the centre and zoom', async () => {
    const { ref, view } = await mountPage();
    await act(() => ref.current?.setCamera({ center: [7.5, 46.5], zoom: 13 }, 500));
    const script = injected.join('\n');
    expect(script).toContain('window.map.easeTo');
    expect(script).toContain('"center":[7.5,46.5]');
    expect(script).toContain('"zoom":13');
    await view.unmount();
  });
});
