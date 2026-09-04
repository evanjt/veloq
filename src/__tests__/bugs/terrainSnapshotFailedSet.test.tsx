/**
 * Scenario: a card re-requests a preview that keeps failing while a worker is
 * busy, so the idle drain never runs and every failure lands in the failed set
 * again, each copy carrying its full coordinate array.
 * Expected behaviour: the set holds one entry per request whatever the failure
 * count, it is capped, and a drain queues each entry once.
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

const progress: { status: string; completed: number; total: number }[] = [];
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: {
    getState: () => ({
      setTerrainSnapshotProgress: (p: { status: string; completed: number; total: number }) =>
        progress.push(p),
    }),
  },
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

/** Every render the pool has asked for, which is what a drain adds to. */
const queued = () => progress[progress.length - 1]?.total ?? 0;

/**
 * A request already at the last rung of the retry ladder, so one error sends it
 * straight to the failed set with no delayed in-flight retry. That keeps the
 * fake clock still, which matters: the pool's own timeouts would otherwise free
 * the worker this file holds busy and let the idle drain run.
 */
const exhausted = (activityId: string, flat = true): SnapshotRequest => ({
  ...request(activityId, flat),
  _retryAttempt: 1,
});

describe('the failed set holds one entry per request', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Occupy worker 0 and never answer for it, so the queue is never idle. */
  const holdAWorkerBusy = () => pool().requestSnapshot(exhausted('held'));

  /** Fail `activityId` on the free worker without moving the clock. */
  const fail = (activityId: string, flat = true) => {
    pool().requestSnapshot(exhausted(activityId, flat));
    onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ type: 'snapshotError', workerId: 1, activityId, error: 'tiles' }),
      },
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    injected.length = 0;
    progress.length = 0;
    mockCached.clear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    post({ type: 'mapReady', workerId: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queues one retry after fifty failures of the same request', () => {
    holdAWorkerBusy();
    for (let i = 0; i < 50; i++) fail('a1');
    const before = queued();
    const renders = rendered().length;

    pool().retryFailed();

    expect(queued() - before).toBe(1);
    expect(rendered().length - renders).toBe(1);
  });

  it('keeps the drape and the flat basemap as separate entries', () => {
    holdAWorkerBusy();
    fail('a1', true);
    fail('a1', false);
    const before = queued();

    pool().retryFailed();

    expect(queued() - before).toBe(2);
  });

  it('caps the set rather than growing with every distinct activity', () => {
    holdAWorkerBusy();
    for (let i = 0; i < 60; i++) fail(`a${i}`);
    const before = queued();

    pool().retryFailed();

    expect(queued() - before).toBeLessThanOrEqual(30);
  });

  it('drains to empty, so a second drain queues nothing', () => {
    holdAWorkerBusy();
    fail('a1');
    fail('a2');
    pool().retryFailed();
    const before = queued();

    pool().retryFailed();

    expect(queued()).toBe(before);
  });

  it('queues nothing when nothing has failed', () => {
    holdAWorkerBusy();
    const before = queued();

    pool().retryFailed();

    expect(queued()).toBe(before);
  });
});
