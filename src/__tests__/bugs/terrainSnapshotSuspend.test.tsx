/**
 * Scenario: the feed keeps its two snapshot worker WebViews for the whole
 * session, including every minute the athlete spends on another tab. A frozen
 * screen stops React, not the GL context behind it.
 *
 * Expected behaviour: both workers come down while the feed is offscreen and
 * come back with it, and the work in flight when they went is finished rather
 * than lost.
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
let mounted = 0;

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
  React.useEffect(() => {
    mounted++;
    return () => {
      mounted--;
    };
  }, []);
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

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: { getState: () => ({ setTerrainSnapshotProgress: jest.fn() }) },
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

describe('the snapshot pool follows the feed on and off screen', () => {
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
    mounted = 0;
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    workersReady();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds two workers while the feed is on screen', () => {
    expect(mounted).toBe(2);
  });

  it('holds none while the feed is offscreen', () => {
    setSuspended(true);

    expect(mounted).toBe(0);
  });

  it('builds both back when the feed returns', () => {
    setSuspended(true);
    setSuspended(false);

    expect(mounted).toBe(2);
  });

  it('renders nothing while suspended, and the request waits', () => {
    setSuspended(true);

    pool().requestSnapshot(request('a1'));

    expect(rendered()).toEqual([]);

    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('finishes the render that was in flight when the feed left', () => {
    pool().requestSnapshot(request('a1'));
    expect(rendered()).toEqual(['a1']);

    setSuspended(true);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1', 'a1']);
  });

  it('does not fail the queue while it is suspended', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);

    jest.advanceTimersByTime(60_000);
    setSuspended(false);
    workersReady();

    expect(rendered()).toEqual(['a1', 'a1']);
  });
});
