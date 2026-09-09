/**
 * Scenario: the athlete leaves the feed part way through a render, so the pool
 * is torn down with its queue half done.
 *
 * Expected behaviour: the reported progress goes idle, because a pause is
 * neither progress nor failure and nothing that could clear it can run while
 * suspended. The queue itself is untouched, so resuming reports the same count
 * it had and finishes the work.
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

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

const mockSetProgress = jest.fn();
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: { getState: () => ({ setTerrainSnapshotProgress: mockSetProgress }) },
}));

const post = (payload: Record<string, unknown>) =>
  onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });

const request = (activityId: string): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat: true,
});

/** Every request the pool has handed to a worker so far, oldest first. */
const rendered = () =>
  injected
    .map((script) => /var activityId = '([^']+)'/.exec(script)?.[1])
    .filter((id): id is string => !!id);

const lastProgress = () => mockSetProgress.mock.calls[mockSetProgress.mock.calls.length - 1]?.[0];

describe('the progress the snapshot pool reports across a suspend', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: ReturnType<typeof render>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const setSuspended = (suspended: boolean) =>
    view.rerender(<TerrainSnapshotWebView ref={ref} suspended={suspended} />);

  const workersReady = () => {
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    injected.length = 0;
    mockSetProgress.mockClear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    workersReady();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports rendering while the queue is being worked', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('goes idle when the feed leaves part way through', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));

    setSuspended(true);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('reports the same count again when the feed comes back', () => {
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));
    setSuspended(true);

    setSuspended(false);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('keeps the queue, so the work still runs after the feed returns', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;

    setSuspended(true);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('says nothing new on a suspend with no queue at all', () => {
    mockSetProgress.mockClear();

    setSuspended(true);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });
});
