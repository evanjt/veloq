/**
 * Scenario: in `smart` 3D mode the feed mixes flat and drape cards by whether
 * the ride has terrain worth draping. The pool handed each request to
 * whichever worker was free first, so a feed of ride, run, ride, run gave each
 * worker flat, drape, flat, drape and every render rebuilt the whole style
 * rather than jumping the camera over the one already mounted.
 *
 * Expected behaviour: the pool sends a render to a free worker that already
 * holds its style and mode, and sends it to any free worker when none does.
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
/** Which activity each worker was asked to render, in order. */
const injected: string[][] = [[], []];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

let mountIndex = 0;
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
      const named = /var activityId = ["']([^"']+)["']/.exec(script);
      if (named && injected[id]) injected[id].push(named[1]);
    },
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

const request = (activityId: string, flat: boolean): SnapshotRequest => ({
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

/** Which worker was handed `activityId`, or -1. */
function tookIt(activityId: string): number {
  return injected.findIndex((list) => list.includes(activityId));
}

describe('which worker a render goes to', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  /** Give worker 0 a flat render and worker 1 a drape, then free both. */
  function settleWorkers() {
    pool().requestSnapshot(request('flat-seed', true));
    post({ type: 'mapReady', workerId: 0 });
    pool().requestSnapshot(request('drape-seed', false));
    post({ type: 'mapReady', workerId: 1 });
    post({ type: 'snapshot', workerId: 0, activityId: 'flat-seed', base64: 'AAAA', gen: 1 });
    post({ type: 'snapshot', workerId: 1, activityId: 'drape-seed', base64: 'AAAA', gen: 1 });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mountIndex = 0;
    injected[0] = [];
    injected[1] = [];
    ref = React.createRef<TerrainSnapshotWebViewRef>();
  });

  afterEach(() => jest.useRealTimers());

  it('sends a flat render to the worker that last drew flat', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();
    expect(tookIt('flat-seed')).toBe(0);
    expect(tookIt('drape-seed')).toBe(1);

    pool().requestSnapshot(request('a-flat', true));

    expect(tookIt('a-flat')).toBe(0);
  });

  it('sends a drape to the worker that last drew a drape', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();

    pool().requestSnapshot(request('a-drape', false));

    expect(tookIt('a-drape')).toBe(1);
  });

  it('sends it out anyway when the matching worker is busy', () => {
    render(<TerrainSnapshotWebView ref={ref} />);
    settleWorkers();

    // Worker 0 takes a flat render and is now busy.
    pool().requestSnapshot(request('holds-0', true));
    expect(tookIt('holds-0')).toBe(0);

    // A second flat render has no matching worker free. It must not wait.
    pool().requestSnapshot(request('a-flat-2', true));

    expect(tookIt('a-flat-2')).toBe(1);
  });
});
