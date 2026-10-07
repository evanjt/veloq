/**
 * Scenario: the basemap is switched, then the page is rebuilt (reclaimer
 * rebuild) or the switch lands before the page first reports ready.
 * Expected behaviour: once the page reports ready it is moved to the style the
 * toggle shows, on both the 2D and the 3D surface.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import {
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
} from '@/features/maps/lib/mapSurfaceRegistry';

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

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
}));

type Style = 'light' | 'satellite';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function ready(): void {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
}

const surfaces = {
  '2D': {
    element: (mapStyle: Style) => (
      <MapSurface
        mapStyle={mapStyle}
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    ),
    swapsTo: (script: string, style: Style) =>
      script.includes('setStyle') && script.includes(style === 'satellite' ? 'satellite' : 'light'),
  },
  '3D': {
    element: (mapStyle: Style) => (
      <Map3DWebView coordinates={[]} mapStyle={mapStyle} routesGeoJSON={EMPTY} />
    ),
    swapsTo: (script: string, style: Style) =>
      script.includes('setStyle') && script.includes(`var isSatellite = ${style === 'satellite'};`),
  },
} as const;

beforeEach(() => {
  injected.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe.each(Object.entries(surfaces))('%s style after the page is rebuilt', (_name, surface) => {
  it('re-applies the shown style when a released page is rebuilt', () => {
    const view = render(surface.element('light'));
    ready();
    view.rerender(surface.element('satellite'));
    expect(injected.some((s) => surface.swapsTo(s, 'satellite'))).toBe(true);

    releaseMountedSurfaces();
    rebuildReleasedSurfaces();
    injected.length = 0;
    ready();

    expect(injected.some((s) => surface.swapsTo(s, 'satellite'))).toBe(true);
    view.unmount();
  });

  it('applies a style chosen before the page first reports ready', () => {
    const view = render(surface.element('light'));
    view.rerender(surface.element('satellite'));
    injected.length = 0;

    ready();

    expect(injected.some((s) => surface.swapsTo(s, 'satellite'))).toBe(true);
    view.unmount();
  });

  it('leaves the page alone when the shown style is the one it was built with', () => {
    const view = render(surface.element('light'));
    injected.length = 0;

    ready();

    expect(injected.some((s) => s.includes('setStyle'))).toBe(false);
    view.unmount();
  });
});
