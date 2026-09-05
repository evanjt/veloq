/**
 * Scenario: the process is a kill candidate in the background, and a 2D
 * surface holds a MapLibre instance and every texture in it.
 * Expected behaviour: the release reaches the page as a `map.remove()`, the
 * surface then sends nothing to a page with no map, and the rebuild on the next
 * foreground reloads the page, whose `mapReady` resends the whole spec.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
}));

const SOURCE = {
  track: { kind: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } },
};

function post(message: object): void {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(message) } }));
}

function renderSurface(sources: typeof SOURCE | Record<string, never> = SOURCE) {
  return render(
    <MapSurface
      mapStyle="light"
      initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
      sources={sources}
      layers={[]}
    />
  );
}

beforeEach(() => {
  injected.length = 0;
  reload.mockClear();
});

describe('MapSurface under memory pressure', () => {
  it('tears the map down on release and sends nothing more until the rebuild', () => {
    const view = renderSurface();
    post({ type: 'mapReady' });
    const sentBefore = injected.length;
    expect(sentBefore).toBeGreaterThan(0);

    expect(releaseMountedSurfaces()).toBe(1);
    expect(injected[injected.length - 1]).toContain('map.remove()');

    injected.length = 0;
    view.rerender(
      <MapSurface
        mapStyle="light"
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    );
    expect(injected).toEqual([]);

    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(reload).toHaveBeenCalledTimes(1);

    post({ type: 'mapReady' });
    expect(injected.length).toBeGreaterThan(0);
    view.unmount();
  });

  it('is forgotten by the registry once unmounted', () => {
    const view = renderSurface();
    view.unmount();
    expect(releaseMountedSurfaces()).toBe(0);
  });
});
