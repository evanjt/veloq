/**
 * Scenario: the 3D surface is mounted behind a hidden tab when the process
 * becomes a kill candidate.
 * Expected behaviour: the release reaches its page as a `map.remove()`, a layer
 * change while released sends nothing, and the rebuild reloads the page.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import {
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
} from '@/features/maps/lib/mapSurfaceRegistry';

const injected: string[] = [];
const reload = jest.fn();
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
    reload,
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const ONE: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [7.4, 46.9],
          [7.5, 46.95],
        ],
      },
    },
  ],
};

function post(message: object): void {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(message) } }));
}

function surface(routes: GeoJSON.FeatureCollection) {
  return <Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" routesGeoJSON={routes} />;
}

beforeEach(() => {
  injected.length = 0;
  reload.mockClear();
});

describe('Map3DWebView under memory pressure', () => {
  it('tears the map down on release and sends nothing more until the rebuild', () => {
    const view = render(surface(EMPTY));
    post({ type: 'mapReady' });

    expect(releaseMountedSurfaces()).toBe(1);
    expect(injected[injected.length - 1]).toContain('map.remove()');

    injected.length = 0;
    view.rerender(surface(ONE));
    expect(injected).toEqual([]);

    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('is forgotten by the registry once unmounted', () => {
    const view = render(surface(EMPTY));
    view.unmount();
    expect(releaseMountedSurfaces()).toBe(0);
  });
});
