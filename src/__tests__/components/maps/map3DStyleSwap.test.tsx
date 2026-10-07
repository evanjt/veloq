/**
 * Scenario: the 3D map swaps its basemap style. A swap drops every source the
 * new style does not name.
 *
 * Expected behaviour: the style the swap builds still names the route and the
 * scrub marker, whether or not a route is drawn, and the scrub marker and the
 * section creation line are sent again once the swap has settled.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<unknown>
) {
  onMessage = props.onMessage;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

type StyleObj = { sources: Record<string, unknown>; layers: { id: string }[] };

function surface(mapStyle: 'dark' | 'satellite', coordinates: [number, number][]) {
  return (
    <Map3DWebView
      coordinates={coordinates}
      mapStyle={mapStyle}
      routesGeoJSON={EMPTY}
      highlightCoordinate={[7.5, 46.5]}
      sectionCreationStart={[7.4, 46.4]}
    />
  );
}

function styleSwapped(script: string): StyleObj {
  let applied: StyleObj | undefined;
  const map = { setStyle: (s: StyleObj) => (applied = s), once: () => {} };
  const win = { map, _routeCoords: [] as number[][] };
  new Function('window', 'fetch', script)(win, () => Promise.reject(new Error('offline')));
  return applied as StyleObj;
}

beforeEach(() => {
  injected.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('swapping the 3D style', () => {
  it('opens the light style with bundled assets and store tiles', () => {
    const html = buildMap3DHtml({ initStyle: 'light', mapStyle: 'light' } as never);
    expect(html).toContain('/veloq-tile/openmaptiles/');
    expect(html).toContain('veloq-asset/');
  });

  it('uses bundled light tiles when returning from the dark style', () => {
    const view = render(surface('dark', []));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    view.rerender(<Map3DWebView coordinates={[]} mapStyle="light" routesGeoJSON={EMPTY} />);

    const script = injected.find((s) => s.includes('setStyle'));
    expect(script).toBeDefined();
    const style = styleSwapped(script as string);
    expect(JSON.stringify(style.sources.openmaptiles)).toContain('/veloq-tile/');
    expect(JSON.stringify(style)).toContain('veloq-asset/');
    view.unmount();
  });

  it.each([
    ['no route drawn', [] as [number, number][]],
    ['a route drawn', [[7.4, 46.9]] as [number, number][]],
  ])('keeps the route and scrub sources with %s', (_name, coordinates) => {
    const view = render(surface('dark', coordinates));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    injected.length = 0;

    view.rerender(surface('satellite', coordinates));

    const script = injected.find((s) => s.includes('setStyle'));
    expect(script).toBeDefined();
    const style = styleSwapped(script as string);
    expect(Object.keys(style.sources)).toEqual(
      expect.arrayContaining(['route', 'start-end-markers', 'highlight-point'])
    );
    expect(style.layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['route-line', 'highlight-border', 'highlight-fill'])
    );
    view.unmount();
  });

  it('sends the scrub marker and the creation line again once the swap settles', () => {
    const view = render(surface('dark', []));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    view.rerender(surface('satellite', []));
    injected.length = 0;

    act(() => {
      jest.advanceTimersByTime(600);
    });

    expect(injected.some((s) => s.includes("getSource('highlight-point')"))).toBe(true);
    expect(injected.some((s) => s.includes("'section-creation-markers'"))).toBe(true);
    view.unmount();
  });
});
