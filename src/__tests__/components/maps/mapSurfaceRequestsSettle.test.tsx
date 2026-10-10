/**
 * Scenario: a cluster tap asks the map surface for the cluster's leaves while
 * the page is not ready, or while a live page never replies.
 *
 * Expected behaviour: the caller is handed the empty answer, at once when there
 * is no page to ask and within the deadline when the page stays silent, so the
 * tap handler behind the await goes on to its fallback.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
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
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));

function mount() {
  const surface = React.createRef<MapSurfaceRef>();
  const view = render(
    <MapSurface
      ref={surface}
      mapStyle="light"
      initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
      sources={{}}
      layers={[]}
    />
  );
  return { surface, view };
}

function ready(): void {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
}

const clusterRequests = () => injected.filter((script) => script.includes('cluster'));

beforeEach(() => {
  injected.length = 0;
  onMessage = null;
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

describe('map surface requests always settle', () => {
  it('answers empty at once, without asking, before the page is ready', async () => {
    const { surface, view } = mount();

    await expect(surface.current!.getClusterLeaves('clusters', 7)).resolves.toEqual([]);
    await expect(surface.current!.getClusterExpansionZoom('clusters', 7)).resolves.toBeNull();
    await expect(surface.current!.queryFeatures([10, 10], ['clusters'])).resolves.toEqual([]);
    expect(clusterRequests()).toEqual([]);
    view.unmount();
  });

  it('answers empty when a ready page never replies', async () => {
    const { surface, view } = mount();
    ready();

    const leaves = surface.current!.getClusterLeaves('clusters', 7);
    const zoom = surface.current!.getClusterExpansionZoom('clusters', 7);
    expect(clusterRequests()).toHaveLength(2);

    act(() => jest.advanceTimersByTime(5000));

    await expect(leaves).resolves.toEqual([]);
    await expect(zoom).resolves.toBeNull();
    view.unmount();
  });

  it('passes the page answer through when it replies in time', async () => {
    const { surface, view } = mount();
    ready();

    const zoom = surface.current!.getClusterExpansionZoom('clusters', 7);
    const requestId = /req_\d+/.exec(clusterRequests()[0])![0];
    act(() =>
      onMessage?.({
        nativeEvent: {
          data: JSON.stringify({ type: 'clusterExpansionZoom', requestId, zoom: 13 }),
        },
      })
    );

    await expect(zoom).resolves.toBe(13);
    view.unmount();
  });
});
