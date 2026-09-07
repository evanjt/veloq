/**
 * Scenario: the athlete comes back to the feed and a rebuilt worker never
 * posts `mapReady`, which is what happens when Android has reclaimed the
 * WebView process.
 *
 * Expected behaviour: the staleness watchdog fails the queue and the pipeline
 * returns to idle. The suspend branch clears `mapReadyRef` on every worker and
 * `processNext` skips a worker that is not ready, so the resume call could do
 * nothing by construction; the watchdog was armed only from `updateProgress`,
 * and the one transition that most needed it never reached it.
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

/** The watchdog's own timeout, from the component. */
const STALENESS_TIMEOUT_MS = 15000;

describe('a resume where no worker ever becomes ready', () => {
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

  it('fails the queue within the staleness timeout rather than wedging', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    setSuspended(false);
    // No `mapReady` after the rebuild: the reclaimed process never answers.

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 1 });

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(lastProgress()).toEqual({ status: 'idle', completed: 0, total: 0 });
  });

  it('leaves the queue alone while the watchdog is still waiting', () => {
    pool().requestSnapshot(request('a1'));
    setSuspended(true);
    setSuspended(false);

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS - 1);

    expect(lastProgress()).toEqual({ status: 'rendering', completed: 0, total: 1 });
  });

  it('runs the work instead of failing it when a worker does come back', () => {
    pool().requestSnapshot(request('a1'));
    injected.length = 0;
    setSuspended(true);
    setSuspended(false);

    workersReady();

    expect(rendered()).toEqual(['a1']);
  });

  it('arms nothing on a resume with an empty queue', () => {
    setSuspended(true);
    setSuspended(false);
    mockSetProgress.mockClear();

    jest.advanceTimersByTime(STALENESS_TIMEOUT_MS + 1);

    expect(mockSetProgress).not.toHaveBeenCalled();
  });
});
