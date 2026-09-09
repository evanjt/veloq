/**
 * Scenario: a tile server answers 429. Two of those reject the whole render,
 * and the pipeline's answer was to send the request straight back at the same
 * host, through two workers with a queue up to thirty deep.
 *
 * Expected behaviour: a throttle is an instruction to wait, so it stops the
 * whole pool rather than one request, and the athlete pulling to refresh
 * cannot defeat the wait. An ordinary tile error is not a throttle and leaves
 * the pool running.
 */

import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
const injected: string[] = [];

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
  useSyncDateRange: {
    getState: () => ({ setTerrainSnapshotProgress: () => {} }),
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

const THROTTLE_BACKOFF_MS = 30000;

describe('a throttled tile server stops the pool', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** One worker ready, one request rendering, then the error under test. */
  const failFirst = (over: Record<string, unknown>) => {
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });
    injected.length = 0;
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 1,
      error: 'Tile errors: 2',
      ...over,
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCached.clear();
    injected.length = 0;
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing at all while the backoff runs', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS - 1000);
    });

    expect(injected.join('\n')).not.toContain('a0');
    expect(injected.join('\n')).not.toContain('a1');
  });

  it('picks the queue back up once the backoff has run', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });

    // The rejected render is the one at the head, so it goes first.
    expect(injected.join('\n')).toContain('a0');
  });

  it('leaves the pool running for a tile error that is not a throttle', () => {
    failFirst({ tileErrors: 2, tileThrottles: 0 });

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(injected.join('\n')).toContain('a0');
  });

  it('does not let a pull-to-refresh defeat the wait', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(5000);
      pool().retryFailed();
      jest.advanceTimersByTime(1000);
    });

    expect(injected.join('\n')).not.toContain('a0');
    expect(injected.join('\n')).not.toContain('a1');
  });

  it('waits longer the second time the server says no', () => {
    failFirst({ tileErrors: 2, tileThrottles: 2 });
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 2,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
    injected.length = 0;

    // The first wait would already be over by here. The second is twice it.
    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });
    expect(injected).toEqual([]);

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS);
    });
    expect(injected.length).toBeGreaterThan(0);
  });

  it('does not let the staleness watchdog fail the queue for waiting', () => {
    // The watchdog gives up after 15 s of no progress, and the backoff is
    // longer than that on purpose. Waiting as instructed is not being stuck.
    failFirst({ tileErrors: 2, tileThrottles: 2 });

    act(() => {
      jest.advanceTimersByTime(THROTTLE_BACKOFF_MS + 1000);
    });

    expect(injected.join('\n')).toContain('a0');
  });
});
