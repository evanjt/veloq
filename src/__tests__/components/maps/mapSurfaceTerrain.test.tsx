/**
 * Scenario: a screen tilts its 2D map over the terrain by setting the
 * surface's terrain, and the device has no elevation tiles.
 *
 * Expected behaviour: turning terrain on or off ships the terrain alone, with
 * no source or layer re-sent, and the page's report that it has no elevation
 * tiles reaches the caller with its reason.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
import type { MapTerrainSpec } from '@/features/maps/lib/htmlBuilders';

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

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
}));

const SOURCES = {
  ride: { kind: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } },
};
const LAYERS = [{ id: 'ride-line', type: 'line' as const, source: 'ride' }];
const TILTED: MapTerrainSpec = { exaggeration: 1.5, pitch: 60 };

async function post(message: object): Promise<void> {
  await act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(message) } }));
}

function surface(props: Partial<React.ComponentProps<typeof MapSurface>> = {}) {
  return (
    <MapSurface
      mapStyle="light"
      initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
      sources={SOURCES}
      layers={LAYERS}
      {...props}
    />
  );
}

const applied = () => injected.filter((script) => script.includes('_veloq.apply('));

beforeEach(() => {
  injected.length = 0;
});

describe('MapSurface terrain', () => {
  it('ships terrain on and off alone, with no source or layer', async () => {
    const view = render(surface());
    await post({ type: 'mapReady' });
    injected.length = 0;

    await act(() => view.rerender(surface({ terrain: TILTED })));

    expect(applied()).toHaveLength(1);
    expect(applied()[0]).toContain('"terrain":{"exaggeration":1.5,"pitch":60}');
    expect(applied()[0]).not.toContain('"sources"');
    expect(applied()[0]).not.toContain('"layers"');

    injected.length = 0;
    await act(() => view.rerender(surface({ terrain: null })));

    expect(applied()).toHaveLength(1);
    expect(applied()[0]).toContain('"terrain":null');
  });

  it('sends the terrain with the whole spec when the page comes up', async () => {
    render(surface({ terrain: TILTED }));

    await post({ type: 'mapReady' });

    expect(applied()).toHaveLength(1);
    expect(applied()[0]).toContain('"terrain":{"exaggeration":1.5,"pitch":60}');
    expect(applied()[0]).toContain('"sources"');
  });

  it('hands the caller the page report of no elevation tiles', async () => {
    const onTerrainUnavailable = jest.fn();
    render(surface({ terrain: TILTED, onTerrainUnavailable }));
    await post({ type: 'mapReady' });

    await post({
      type: 'terrainUnavailable',
      reason: 'no terrain tiles: 4 failed, none delivered',
    });

    expect(onTerrainUnavailable).toHaveBeenCalledWith('no terrain tiles: 4 failed, none delivered');
  });
});
