/**
 * Scenario: a preview takes seconds on a real handset and nothing installed
 * can say where they went. The worker page's own log is `__DEV__`-gated, the
 * queue trace is written out only once the watchdog decides the queue is
 * wedged, and the debug APK is embedded with `--dev false`.
 *
 * Expected behaviour: the pool records each stage through `recordFFIMetric`,
 * which survives a release build and is what the Developer Dashboard draws. A
 * completed request records one render; an abandoned one records none, or the
 * table's mean would carry renders that never happened.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { getFFIMetricsSummary } from '@/shared/debug/renderTimer';

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

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
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

const SNAPSHOT_TIMEOUT_MS = 8000;

/** How many of `name` the ring holds now. Absent reads as none. */
function calls(name: string): number {
  return getFFIMetricsSummary()[name]?.calls ?? 0;
}

describe('where a preview spends its seconds', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => jest.useRealTimers());

  it.each(['snapshot', 'snapshotError'])(
    'records per-source tile counts from a %s message',
    (type) => {
      const before = calls('snapshot.tiles.satellite');
      render(<TerrainSnapshotWebView ref={ref} />);
      post({ type: 'mapReady', workerId: 0 });
      pool().requestSnapshot(request('tiles'));
      post({
        type,
        workerId: 0,
        activityId: 'tiles',
        base64: 'AAAA',
        gen: 1,
        tileStats: {
          'satellite-eox': { loaded: 8, total: 10 },
          'satellite-swisstopo-9': { loaded: 5, total: 7 },
          terrain: { loaded: 2, total: 2 },
        },
      });
      expect(calls('snapshot.tiles.satellite')).toBe(before + 1);
      expect(getFFIMetricsSummary()['snapshot.tiles.satellite'].maxMs).toBe(13);
      expect(getFFIMetricsSummary()['snapshot.tiles.terrain'].maxMs).toBe(2);
      expect(getFFIMetricsSummary()['snapshot.tiles.satellite-eox']).toBeUndefined();
      // A duplicate or stale message cannot count a second render.
      post({
        type,
        workerId: 0,
        activityId: 'tiles',
        base64: 'AAAA',
        gen: 1,
        tileStats: { terrain: { loaded: 99 } },
      });
      expect(calls('snapshot.tiles.satellite')).toBe(before + 1);
      expect(getFFIMetricsSummary()['snapshot.tiles.terrain'].maxMs).toBe(2);
    }
  );

  it('records no tile reading when the message carries none', () => {
    const before = calls('snapshot.tiles.terrain');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('no-counts'));
    post({ type: 'snapshot', workerId: 0, activityId: 'no-counts', base64: 'AAAA', gen: 1 });
    expect(calls('snapshot.tiles.terrain')).toBe(before);
  });

  it('times a worker booting, from its mount to mapReady', () => {
    const before = calls('snapshot.boot');
    render(<TerrainSnapshotWebView ref={ref} />);

    post({ type: 'mapReady', workerId: 0 });

    expect(calls('snapshot.boot')).toBe(before + 1);
  });

  it('times the wait and the render of a request that completes', () => {
    const beforeWait = calls('snapshot.wait');
    const beforeRender = calls('snapshot.render.flat');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.wait')).toBe(beforeWait + 1);
    expect(calls('snapshot.render.flat')).toBe(beforeRender + 1);
  });

  it('files a drape apart from a flat render', () => {
    const before = calls('snapshot.render.drape');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0', false));
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.render.drape')).toBe(before + 1);
  });

  it('times nothing for a render the timeout abandoned', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('a0'));

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    const after = calls('snapshot.render.flat');
    // The late arrival is discarded by the generation guard, so it must not
    // land a reading either: a render that was never captured has no duration.
    post({ type: 'snapshot', workerId: 0, activityId: 'a0', base64: 'AAAA', gen: 1 });

    expect(calls('snapshot.render.flat')).toBe(after);
  });

  it('records the page elapsed under the path it took', () => {
    const before = calls('snapshot.page.fast');
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      fastPath: true,
      elapsed: 120,
    });

    expect(calls('snapshot.page.fast')).toBe(before + 1);
  });

  it('records the stages the page stamped inside that elapsed', () => {
    const before = ['style', 'settle', 'probe', 'encode'].map((p) => calls(`snapshot.phase.${p}`));
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });

    pool().requestSnapshot(request('a0'));
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      elapsed: 3_540,
      phases: { style: 40, settle: 3_200, probe: 180, encode: 120 },
    });

    expect(['style', 'settle', 'probe', 'encode'].map((p) => calls(`snapshot.phase.${p}`))).toEqual(
      before.map((n) => n + 1)
    );
  });

  it('records no stage for a render the timeout abandoned', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('a0'));

    jest.advanceTimersByTime(SNAPSHOT_TIMEOUT_MS + 1);
    const after = calls('snapshot.phase.settle');
    post({
      type: 'snapshot',
      workerId: 0,
      activityId: 'a0',
      base64: 'AAAA',
      gen: 1,
      phases: { style: 40, settle: 3_200 },
    });

    expect(calls('snapshot.phase.settle')).toBe(after);
  });
});
