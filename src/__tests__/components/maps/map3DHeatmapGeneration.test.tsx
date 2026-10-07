/**
 * Scenario: a tile pass finishes while the 3D page is open. MapLibre does not
 * ask again for a tile URL it has already resolved, so the page keeps the
 * missing tiles until the camera moves.
 *
 * Expected behaviour: the surface reloads the heatmap source with the versioned
 * template, and a style swap afterwards re-adds the source with the same one.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let html: string | undefined;
let mockGeneration = 0;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

jest.mock('@/features/maps/lib/heatmapGeneration', () => ({
  useHeatmapGeneration: () => mockGeneration,
  reportHeatmapView: () => {},
  clearHeatmapView: () => {},
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    source: { html: string };
  },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  html = props.source.html;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function surface(mapStyle: 'light' | 'dark' = 'light') {
  return (
    <Map3DWebView
      coordinates={[[7.4, 46.9]]}
      mapStyle={mapStyle}
      routesGeoJSON={EMPTY}
      showHeatmap
    />
  );
}

function ready() {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
}

beforeEach(() => {
  injected.length = 0;
  html = undefined;
  mockGeneration = 0;
});

describe('a finished tile pass in 3D', () => {
  it('points the heatmap source at the versioned template without reloading the page', () => {
    const view = render(surface());
    ready();
    const before = html;
    injected.length = 0;

    mockGeneration = 1;
    view.rerender(surface());

    const script = injected.find((s) => s.includes('setTiles'));
    expect(script).toContain(JSON.stringify(heatmapTileTemplate(1)));
    expect(html).toBe(before);
    view.unmount();
  });

  it('sends nothing on mount, where the page already holds the current template', () => {
    mockGeneration = 3;
    const view = render(surface());
    ready();

    expect(injected.some((s) => s.includes('setTiles'))).toBe(false);
    expect(html).toContain(JSON.stringify(heatmapTileTemplate(3)));
    view.unmount();
  });

  it('re-adds the source after a style swap with the versioned template', () => {
    const view = render(surface('light'));
    ready();
    mockGeneration = 2;
    view.rerender(surface('light'));
    injected.length = 0;

    view.rerender(surface('dark'));

    const swap = injected.find((s) => s.includes("addSource('heatmap-tiles'"));
    expect(swap).toContain(JSON.stringify(heatmapTileTemplate(2)));
    view.unmount();
  });
});
