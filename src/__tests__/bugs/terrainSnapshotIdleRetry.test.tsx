/**
 * Scenario: the snapshot pool fails a render, and the athlete never pulls to
 * refresh.
 * Expected behaviour: the failure is retried once the queue goes idle, silently
 * and once. Pull-to-refresh is the only other way back, and a card that never
 * gets one shows the route line for good.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;

// A getter, because the factory is hoisted above this file's own bindings and
// the component below is one of them.
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
  }));
  return <View />;
});

const mockCached = new Set<string>();
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(`${id}_${style}_${is3D}`),
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: { getState: () => ({ setTerrainSnapshotProgress: jest.fn() }) },
}));

// The in-flight retry is delayed to let the tile servers recover, so a posted
// failure only reaches the pool once that timer has run.
const post = (payload: Record<string, unknown>) => {
  onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });
  jest.advanceTimersByTime(2000);
};

const request = (activityId: string, flat = true): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat,
});

/** Every request the pool has handed to a worker so far, oldest first. */
const rendered = () =>
  injected
    .map((script) => /var activityId = '([^']+)'/.exec(script)?.[1])
    .filter((id): id is string => !!id);

describe('the snapshot pool retries a failure when the queue goes idle', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    injected.length = 0;
    mockCached.clear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-renders a failed request without a pull to refresh', () => {
    pool().requestSnapshot(request('a1'));
    expect(rendered()).toEqual(['a1']);

    // Two failures: the first is the in-flight retry the error path already
    // does, the second exhausts it and lands in the failed set.
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 1 });
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 2 });

    expect(rendered()).toEqual(['a1', 'a1', 'a1']);
  });

  it('retries once and then leaves the card to the route line', () => {
    pool().requestSnapshot(request('a1'));
    for (let i = 1; i <= 4; i++) {
      post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: i });
    }

    expect(rendered().length).toBe(3);
  });

  it('does not retry a request whose preview arrived some other way', () => {
    pool().requestSnapshot(request('a1'));
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 1 });
    mockCached.add('a1_light_false');
    post({ type: 'snapshotError', workerId: 0, activityId: 'a1', error: 'tiles', gen: 2 });

    expect(rendered()).toEqual(['a1', 'a1']);
  });

  it('keeps the drape and the flat basemap apart while one is in flight', () => {
    pool().requestSnapshot(request('a1', true));
    pool().requestSnapshot(request('a1', false));

    expect(rendered()).toEqual(['a1', 'a1']);
  });
});
