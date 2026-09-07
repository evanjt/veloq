/**
 * Scenario: a worker's render times out, the pool has nothing else to give it,
 * and the WebView posts its snapshot back a moment later.
 *
 * Expected behaviour: the late snapshot is discarded. The timeout already
 * counted that request as completed, so counting it again puts `completed`
 * past `total` and the progress reports done while other cards are still
 * queued.
 *
 * The generation counter is what tells a stale render from a live one, and it
 * only moves when a new request is assigned. A worker abandoned with nothing
 * to take next keeps the timed-out request's generation, so its late snapshot
 * passes the guard.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

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
    injectJavaScript: () => {},
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

const mockProgress = jest.fn();
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: {
    getState: () => ({
      setTerrainSnapshotProgress: (progress: unknown) => mockProgress(progress),
    }),
  },
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

const SNAPSHOT_TIMEOUT_MS = 8000;

type Progress = { status: string; completed: number; total: number };

const lastProgress = (): Progress =>
  mockProgress.mock.calls[mockProgress.mock.calls.length - 1][0] as Progress;

describe('a snapshot that arrives after its render was abandoned', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCached.clear();
    mockProgress.mockClear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is not counted when a pause put its request back on the queue', () => {
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);

    // a0 is back on the queue and still owed a render, so nothing is done yet.
    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });

  it('is not counted twice when the timeout already counted it', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    post({ type: 'mapReady', workerId: 0 });

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    pool().requestSnapshot(request('a1'));
    mockProgress.mockClear();

    // The timeout counted a0 and released the worker. Its render arriving now
    // must not count a second time against the queue a1 is waiting in.
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    for (const call of mockProgress.mock.calls) {
      const p = call[0] as Progress;
      expect(p.completed).toBeLessThanOrEqual(p.total);
    }
  });

  it('still counts the render the worker is actually holding', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 1, total: 2 });
  });

  it('does not let a paused error count a request that is queued again', () => {
    const tree = render(<TerrainSnapshotWebView ref={ref} />);
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });

    tree.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    post({ type: 'snapshotError', workerId: 0, activityId: 'a0', error: 'boom' });
    tree.rerender(<TerrainSnapshotWebView ref={ref} />);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 2 });
  });
});
