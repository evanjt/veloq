/**
 * Scenario: the preview pool stops moving on a release build, where every log
 * it carries has been stripped from the bundle.
 * Expected behaviour: the watchdog holding four times in a row is a wedged
 * queue rather than a busy one, and the trace comes out once through the only
 * console call a release build keeps.
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

const STALENESS_TIMEOUT_MS = 15000;
const THROTTLE_BACKOFF_MS = 30000;

describe('a wedged pool reports what it did', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let reported: string[];

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCached.clear();
    injected.length = 0;
    reported = [];
    jest.spyOn(console, 'error').mockImplementation((line: unknown) => {
      reported.push(String(line));
    });
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Two throttles, so the backoff outlasts four watchdog holds. */
  const throttlePool = () => {
    pool().requestSnapshot(request('a0'));
    pool().requestSnapshot(request('a1'));
    post({ type: 'mapReady', workerId: 0 });
    post({
      type: 'snapshotError',
      workerId: 0,
      activityId: 'a0',
      gen: 1,
      error: 'Tile errors: 2',
      tileErrors: 2,
      tileThrottles: 2,
    });
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
  };

  it('says nothing while the watchdog has only held once or twice', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 2 + 1000);
    });

    expect(reported).toEqual([]);
  });

  it('names the hold reason, the queue and what led there', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 4 + 1000);
    });

    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('[SnapshotQueue] stalled:');
    expect(reported[0]).toContain('waiting out a tile throttle');
    expect(reported[0]).toContain('enqueue a0');
    expect(reported[0]).toContain('start w0 a0');
  });

  it('reports a run of holds once, not every fifteen seconds after it', () => {
    throttlePool();

    act(() => {
      jest.advanceTimersByTime(STALENESS_TIMEOUT_MS * 12 + 1000);
    });

    expect(reported).toHaveLength(1);
  });
});
