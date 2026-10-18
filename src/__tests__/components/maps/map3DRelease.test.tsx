/**
 * Scenario: the 3D surface is mounted behind a hidden tab when the process
 * becomes a kill candidate, or mounts on a held page another 3D mount dropped.
 * Expected behaviour: the release reaches its page as a `map.remove()`, a layer
 * change while released sends nothing, and the rebuild reloads the page. A held
 * page handed over is built in place from the mount's current state, with the
 * layers held back until the rebuilt map is ready.
 */

import React from 'react';
import { AppState, View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { MapSurface } from '@/features/maps/components/MapSurface';
import { map3DPageRevision } from '@/features/maps/lib/htmlBuilders/map3D';
import {
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
} from '@/features/maps/lib/mapSurfaceRegistry';

const injected: string[] = [];
const reload = jest.fn();
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let androidLayerType: string | undefined;
/** The native component each mount asked for, by the page it loads. */
const mockMounted: { component: string | undefined; html: string | undefined }[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    androidLayerType?: string;
    nativeConfig?: { component?: { displayName?: string } };
    source?: { html?: string };
  },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  androidLayerType = props.androidLayerType;
  mockMounted.push({
    component: props.nativeConfig?.component?.displayName,
    html: props.source?.html,
  });
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload,
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

// The native configs as one platform builds them, when a test sets one.
const mockVeloqWebView: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/features/maps/lib/veloqWebView', () => {
  const actual = jest.requireActual('@/features/maps/lib/veloqWebView');
  return new Proxy(actual, {
    get: (target, key) => (mockVeloqWebView.current ?? target)[key as string],
  });
});

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

async function post(message: object): Promise<void> {
  await act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(message) } }));
}

function surface(routes: GeoJSON.FeatureCollection) {
  return <Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" routesGeoJSON={routes} />;
}

beforeEach(() => {
  injected.length = 0;
  mockMounted.length = 0;
  reload.mockClear();
});

describe('Map3DWebView under memory pressure', () => {
  it('tears the map down on release and sends nothing more until the rebuild', async () => {
    const view = await render(surface(EMPTY));
    await post({ type: 'mapReady' });

    expect(releaseMountedSurfaces()).toBe(1);
    expect(injected[injected.length - 1]).toContain('map.remove()');

    injected.length = 0;
    await view.rerender(surface(ONE));
    expect(injected).toEqual([]);

    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('holds no offscreen hardware layer, which redraws whole on every pan frame', async () => {
    const view = await render(surface(EMPTY));
    expect(androidLayerType).not.toBe('hardware');
    await view.unmount();
  });

  it('is forgotten by the registry once unmounted', async () => {
    const view = await render(surface(EMPTY));
    await view.unmount();
    expect(releaseMountedSurfaces()).toBe(0);
  });

  it('reloads a page after it reports a native release on return', async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    const view = await render(surface(EMPTY));
    await post({ type: 'mapReady' });
    injected.length = 0;

    await post({ type: 'nativeMapReleased' });

    expect(injected).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(rebuildReleasedSurfaces()).toBe(0);
    await view.unmount();
  });
});

describe('Map3DWebView on a held page', () => {
  const ROUTE: [number, number][] = [
    [7.4, 46.9],
    [7.5, 46.95],
  ];
  const heldSurface = (routes: GeoJSON.FeatureCollection, mapStyle: 'light' | 'dark' = 'light') => (
    <Map3DWebView coordinates={ROUTE} mapStyle={mapStyle} routesGeoJSON={routes} />
  );
  const builds = () => injected.filter((script) => script.includes('window._veloqBuildMap('));
  const layerUpdates = () =>
    injected.filter((script) => script.includes(`['routes', ${JSON.stringify(ONE)}]`));

  it('builds the map in place from the current route, camera and style, and loads nothing', async () => {
    const view = await render(heldSurface(EMPTY));
    const html = mockMounted[mockMounted.length - 1].html;
    await post({
      type: 'cameraState',
      gesture: true,
      camera: { center: [7.45, 46.92], zoom: 13.5, bearing: 20, pitch: 55 },
    });
    await view.rerender(heldSurface(EMPTY, 'dark'));
    mockMounted.length = 0;
    injected.length = 0;

    await post({ type: 'pageAdopted', revision: map3DPageRevision() });

    expect(builds()).toHaveLength(1);
    const build = builds()[0];
    expect(build).toContain('coordinates: [[7.4,46.9],[7.5,46.95]]');
    expect(build).toContain('center: [7.45,46.92]');
    expect(build).toContain('zoom: 13.5');
    expect(build).toContain('bearing: 20');
    expect(build).toContain('pitch: 55');
    expect(build).toContain('hasSavedCamera: true');
    // The dark base's own style, not the light one the page was first built in.
    expect(build).toContain('"name":"Dark Matter"');
    expect(reload).not.toHaveBeenCalled();
    expect(mockMounted.every((mount) => mount.html === html)).toBe(true);
    await view.unmount();
  });

  it('holds a layer update sent before the rebuilt map is ready and sends it after', async () => {
    const view = await render(heldSurface(EMPTY));
    await post({ type: 'pageAdopted', revision: map3DPageRevision() });
    injected.length = 0;

    await view.rerender(heldSurface(ONE));
    expect(layerUpdates()).toEqual([]);

    jest.useFakeTimers();
    try {
      await post({ type: 'mapReady' });
      await act(() => jest.runOnlyPendingTimers());
    } finally {
      jest.useRealTimers();
    }
    expect(layerUpdates()).toHaveLength(1);
    await view.unmount();
  });

  it('builds nothing for a page that names another revision', async () => {
    const view = await render(heldSurface(EMPTY));
    injected.length = 0;

    await post({ type: 'pageAdopted', revision: '00000000' });

    expect(builds()).toEqual([]);
    await view.unmount();
  });
});

describe('the native component each map mounts', () => {
  async function mountedOn(os: 'android' | 'ios'): Promise<Record<string, string | undefined>> {
    // The config module is read again under `os`, and the mounts read it
    // through the proxy above, so they render with this file's React.
    jest.isolateModules(() => {
      const { Platform } = require('react-native');
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
      mockVeloqWebView.current = jest.requireActual('@/features/maps/lib/veloqWebView');
    });
    const found: Record<string, string | undefined> = {};
    try {
      mockMounted.length = 0;
      const map3D = await render(<Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" />);
      found.map3D = mockMounted[mockMounted.length - 1]?.component;
      await map3D.unmount();

      mockMounted.length = 0;
      const surface = await render(
        <MapSurface
          mapStyle="light"
          initialCamera={{ center: [7.4, 46.9], zoom: 10 }}
          sources={{}}
          layers={[]}
        />
      );
      found.surface = mockMounted[mockMounted.length - 1]?.component;
      await surface.unmount();
    } finally {
      mockVeloqWebView.current = null;
    }
    return found;
  }

  it('is the 3D component for the 3D map on Android, and the shared one for the 2D surface', async () => {
    expect(await mountedOn('android')).toEqual({
      map3D: 'VeloqMap3DWebView',
      surface: 'VeloqWebView',
    });
  });

  it('is the shared component for both on iOS', async () => {
    expect(await mountedOn('ios')).toEqual({ map3D: 'VeloqWebView', surface: 'VeloqWebView' });
  });
});
