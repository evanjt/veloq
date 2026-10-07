/**
 * Scenario: once 3D is showing the 2D surface is unmounted, so fit all, locate
 * and the popup zoom called a null ref and the camera stayed put.
 *
 * Expected behaviour: with 3D showing, each of them moves the 3D map, and the
 * 3D ref turns the move into a page script.
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
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { longitude: 7.5, latitude: 46.5 } })),
  Accuracy: { Balanced: 3 },
}));

function surface2D() {
  return { fitBounds: jest.fn(), setCamera: jest.fn(), resetOrientation: jest.fn() };
}

function surface3D() {
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

function mountHandlers(is3DMode: boolean, selected: unknown = null) {
  const s2 = surface2D();
  const s3 = surface3D();
  const rendered = renderHook(() =>
    useMapHandlers({
      activities,
      selected,
      setSelected: jest.fn(),
      setSelectedSectionId: jest.fn(),
      setSectionChoices: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRoute: jest.fn(),
      userLocation: null,
      setUserLocation: jest.fn(),
      setLocationLoading: jest.fn(),
      currentZoomRef: { current: 8 },
      currentCenterRef: { current: [7, 46] },
      surfaceRef: { current: is3DMode ? null : s2 } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: s3 } as React.RefObject<Map3DWebViewRef | null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: 8 },
      is3DMode,
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    } as never)
  );
  return { rendered, s2, s3 };
}

describe('camera handlers while 3D is showing', () => {
  it('fit all fits every activity on the 3D map', () => {
    const { rendered, s3 } = mountHandlers(true);
    act(() => rendered.result.current.handleFitAll());
    expect(s3.fitBounds).toHaveBeenCalledWith(
      { sw: [7.0, 46.0], ne: [7.8, 46.9] },
      expect.anything(),
      500
    );
  });

  it('fit all still drives the 2D surface in 2D', () => {
    const { rendered, s2, s3 } = mountHandlers(false);
    act(() => rendered.result.current.handleFitAll());
    expect(s2.fitBounds).toHaveBeenCalledWith(
      { sw: [7.0, 46.0], ne: [7.8, 46.9] },
      expect.anything(),
      500
    );
    expect(s3.fitBounds).not.toHaveBeenCalled();
  });

  it('the popup zoom fits the selected activity on the 3D map', () => {
    const { rendered, s3 } = mountHandlers(true, { activity: activities[1] });
    act(() => rendered.result.current.handleZoomToActivity());
    expect(s3.fitBounds).toHaveBeenCalledWith(
      { sw: [7.4, 46.5], ne: [7.8, 46.9] },
      expect.anything(),
      expect.any(Number)
    );
  });

  it('locate centres the 3D map on the fix', async () => {
    const { rendered, s3 } = mountHandlers(true);
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalled();
    expect(s3.setCamera).toHaveBeenCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
  });
});

describe('Map3DWebViewRef camera commands', () => {
  function mountPage() {
    const ref = React.createRef<Map3DWebViewRef>();
    const view = render(<Map3DWebView ref={ref} coordinates={[[7.4, 46.9]]} mapStyle="light" />);
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    injected.length = 0;
    return { ref, view };
  }

  it('fitBounds injects a fit of the box with its padding and duration', () => {
    const { ref, view } = mountPage();
    act(() => ref.current?.fitBounds({ sw: [7.0, 46.0], ne: [7.8, 46.9] }, 40, 500));
    const script = injected.join('\n');
    expect(script).toContain('window.map.fitBounds([[7,46],[7.8,46.9]]');
    expect(script).toContain('duration: 500');
    view.unmount();
  });

  it('setCamera eases to the centre and zoom', () => {
    const { ref, view } = mountPage();
    act(() => ref.current?.setCamera({ center: [7.5, 46.5], zoom: 13 }, 500));
    const script = injected.join('\n');
    expect(script).toContain('window.map.easeTo');
    expect(script).toContain('"center":[7.5,46.5]');
    expect(script).toContain('"zoom":13');
    view.unmount();
  });
});
