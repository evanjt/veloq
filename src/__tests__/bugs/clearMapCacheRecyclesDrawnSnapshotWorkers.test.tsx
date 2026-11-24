/**
 * Scenario: one snapshot worker has drawn a map and the other has drawn nothing.
 * The athlete clears the map cache while the pool sits idle, before its own
 * idle countdown has run.
 * Expected behaviour: the worker that drew rebuilds its map at once, so the
 * raster tiles its page holds are freed. The worker that never drew is left
 * alone, and a worker mid-render is not torn down under its render.
 */

import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { buildRecycleSnapshotMapScript } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import { recycleDrawnSurfaces } from '@/features/maps/lib/mapSurfaceRegistry';

const injectedByWorker: string[][] = [[], []];
let mountIndex = 0;
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
  const slot = React.useRef<number | null>(null);
  if (slot.current === null) {
    slot.current = mountIndex;
    mountIndex += 1;
  }
  const id = slot.current;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      injectedByWorker[id]?.push(script);
    },
    reload: () => {},
  }));
  return <View />;
});

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

const post = (payload: Record<string, unknown>) =>
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } }));

const request = (activityId: string): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  flat: true,
});

const recyclesOf = (worker: number) =>
  (injectedByWorker[worker] ?? []).filter((s) => s === buildRecycleSnapshotMapScript()).length;

describe('clearing the map cache with the snapshot pool idle', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: Awaited<ReturnType<typeof render>>;

  const land = async (workerId: number, activityId: string) => {
    await post({
      type: 'snapshot',
      workerId,
      activityId,
      mapStyle: 'light',
      base64: 'AAAA',
      gen: 1,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    mountIndex = 0;
    for (const sent of injectedByWorker) sent.length = 0;
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = await render(<TerrainSnapshotWebView ref={ref} />);
    await post({ type: 'mapReady', workerId: 0 });
    await post({ type: 'mapReady', workerId: 1 });
  });

  afterEach(async () => {
    await view.unmount();
    jest.useRealTimers();
  });

  it('rebuilds the worker that drew and leaves the one that did not', async () => {
    ref.current?.requestSnapshot(request('a0'));
    await land(0, 'a0');

    expect(recycleDrawnSurfaces()).toBe(1);

    expect(recyclesOf(0)).toBe(1);
    expect(recyclesOf(1)).toBe(0);
  });

  it('rebuilds nothing on a second clear before the new map is ready', async () => {
    ref.current?.requestSnapshot(request('a0'));
    await land(0, 'a0');
    recycleDrawnSurfaces();

    expect(recycleDrawnSurfaces()).toBe(0);
    expect(recyclesOf(0)).toBe(1);
  });

  it('rebuilds nothing when no worker has drawn', () => {
    expect(recycleDrawnSurfaces()).toBe(0);
    expect(recyclesOf(0) + recyclesOf(1)).toBe(0);
  });

  it('leaves a worker alone while it is mid-render', () => {
    ref.current?.requestSnapshot(request('a0'));

    expect(recycleDrawnSurfaces()).toBe(0);
    expect(recyclesOf(0)).toBe(0);
  });
});
