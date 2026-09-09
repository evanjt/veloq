/**
 * Scenario: the feed keeps mounting cards, so the snapshot queue overflows and
 * drops its oldest request. The total counted that request anyway.
 *
 * Expected behaviour: a request the pool has thrown away is not counted, so
 * completed can still reach the total and the progress notification reaches
 * done instead of sitting on screen for the whole session.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const MAX_QUEUE_SIZE = 30;

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

type Progress = { status: string; completed: number; total: number };

const lastProgress = (): Progress =>
  mockProgress.mock.calls[mockProgress.mock.calls.length - 1][0] as Progress;

describe('the snapshot progress counts only what can still complete', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Queue `count` requests with no worker ready, so nothing is pulled. */
  const queue = (count: number) => {
    for (let i = 0; i < count; i += 1) pool().requestSnapshot(request(`a${i}`));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCached.clear();
    mockProgress.mockClear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts every request while the queue still holds them all', () => {
    queue(MAX_QUEUE_SIZE);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });

  it('does not count the request the full queue threw away', () => {
    queue(MAX_QUEUE_SIZE + 1);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });

  it('reaches done once everything the queue still holds has completed', () => {
    queue(MAX_QUEUE_SIZE + 1);
    // The oldest was dropped, so the survivors are a1..a30.
    for (let i = 1; i <= MAX_QUEUE_SIZE; i += 1) mockCached.add(`a${i}_light_false`);

    post({ type: 'mapReady', workerId: 0 });

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('keeps counting correctly across a second overflow', () => {
    queue(MAX_QUEUE_SIZE + 5);

    expect(lastProgress().total).toBe(MAX_QUEUE_SIZE);
  });
});
