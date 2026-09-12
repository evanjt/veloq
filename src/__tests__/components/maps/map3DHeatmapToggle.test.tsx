/**
 * Scenario: `showHeatmap` sat in the deps of the page-HTML memo, so toggling
 * the heatmap regenerated the page and reloaded the whole WebView. That reboots
 * maplibre and refetches every DEM and hillshade tile, and the camera goes with
 * it, while a live injection for the same toggle already existed beside it.
 *
 * Expected behaviour: the page is the same page, and the toggle arrives as an
 * opacity change on the layer that is already there.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let html: string | undefined;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
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

function surface(showHeatmap: boolean) {
  return (
    <Map3DWebView
      coordinates={[[7.4, 46.9]]}
      mapStyle="light"
      routesGeoJSON={EMPTY}
      showHeatmap={showHeatmap}
    />
  );
}

beforeEach(() => {
  injected.length = 0;
  html = undefined;
});

describe('toggling the heatmap in 3D', () => {
  it('does not regenerate the page, so the camera and the tiles survive', () => {
    const view = render(surface(false));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    const before = html;

    view.rerender(surface(true));

    expect(html).toBe(before);
    view.unmount();
  });

  it('sends the toggle to the layer that is already there', () => {
    const view = render(surface(false));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    injected.length = 0;

    view.rerender(surface(true));

    expect(
      injected.some((s) => s.includes("setPaintProperty('heatmap-layer', 'raster-opacity'"))
    ).toBe(true);
    view.unmount();
  });
});
