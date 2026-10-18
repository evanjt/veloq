/**
 * Scenario: the feed is focused when the app goes to the background, so the
 * two snapshot workers each hold a MapLibre instance and its GL context.
 * Expected behaviour: the background release reaches both workers as it does
 * every other map surface, a render caught by it goes back on the queue, and
 * the rebuild on return brings each map back in its page.
 */

import React from 'react';
import { AppState, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { buildRecycleSnapshotMapScript } from '@/features/maps/lib/htmlBuilders/snapshotWorker';
import {
  releaseMountedSurfaces,
  rebuildReleasedSurfaces,
} from '@/features/maps/lib/mapSurfaceRegistry';
import { subscribeSnapshotFailure } from '@/features/maps/lib/terrainSnapshotEvents';

/** What each worker was sent, by mount slot. */
const injectedByWorker: string[][] = [[], []];
let mountIndex = 0;
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
  const slot = React.useRef<number | null>(null);
  if (slot.current === null) {
    slot.current = mountIndex;
    mountIndex += 1;
  }
  const id = slot.current;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      injectedByWorker[id]?.push(script);
    },
    reload: () => {},
  }));
  return <View />;
});

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

const post = (payload: Record<string, unknown>) =>
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } }));

const request = (activityId: string): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  flat: true,
});

/** The activities a worker was asked to render, in order. */
const renderedBy = (worker: number) =>
  (injectedByWorker[worker] ?? [])
    .map((script) => /"activityId":"([^"]+)"/.exec(script)?.[1])
    .filter((id): id is string => !!id);

const recyclesOf = (worker: number) =>
  (injectedByWorker[worker] ?? []).filter((s) => s === buildRecycleSnapshotMapScript()).length;

const setAppState = (state: string) =>
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });

describe('the snapshot workers under the background release', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;
  let view: Awaited<ReturnType<typeof render>>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const workersReady = async () => {
    await post({ type: 'mapReady', workerId: 0 });
    await post({ type: 'mapReady', workerId: 1 });
  };

  const clearInjected = () => {
    for (const sent of injectedByWorker) sent.length = 0;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    mountIndex = 0;
    clearInjected();
    setAppState('background');
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    view = await render(<TerrainSnapshotWebView ref={ref} suspended={false} />);
    await workersReady();
  });

  afterEach(async () => {
    await view.unmount();
    jest.useRealTimers();
    setAppState('active');
  });

  it('reaches both workers and tears down each map', () => {
    clearInjected();

    expect(releaseMountedSurfaces()).toBe(2);

    for (const worker of [0, 1]) {
      expect(injectedByWorker[worker]).toHaveLength(1);
      expect(injectedByWorker[worker]?.[0]).toContain('_releaseMap');
    }
  });

  it('renders nothing on a released worker until its map is back', async () => {
    releaseMountedSurfaces();
    pool().requestSnapshot(request('a1'));
    expect([...renderedBy(0), ...renderedBy(1)]).toEqual([]);

    setAppState('active');
    expect(rebuildReleasedSurfaces()).toBe(2);
    expect(recyclesOf(0)).toBe(1);
    expect(recyclesOf(1)).toBe(1);
    expect([...renderedBy(0), ...renderedBy(1)]).toEqual([]);

    await post({ type: 'mapReady', workerId: 0 });

    expect(renderedBy(0)).toEqual(['a1']);
  });

  it('puts a render caught by the release back on the queue rather than failing it', async () => {
    const failed: string[] = [];
    const off = subscribeSnapshotFailure('a1', () => failed.push('a1'));
    pool().requestSnapshot(request('a1'));
    expect(renderedBy(0)).toEqual(['a1']);

    releaseMountedSurfaces();
    // A result posted by the torn-down render is not the picture.
    await post({ type: 'snapshot', workerId: 0, activityId: 'a1', base64: 'x', gen: 1 });
    jest.advanceTimersByTime(60_000);
    expect(failed).toEqual([]);

    setAppState('active');
    rebuildReleasedSurfaces();
    await workersReady();

    expect([...renderedBy(0), ...renderedBy(1)]).toEqual(['a1', 'a1']);
    expect(failed).toEqual([]);
    off();
  });

  it('records a native release and rebuilds that worker alone on return', async () => {
    clearInjected();

    await post({ type: 'nativeMapReleased', workerId: 1 });

    expect(injectedByWorker[1]).toEqual([]);
    pool().requestSnapshot(request('a1'));
    pool().requestSnapshot(request('a2'));
    expect(renderedBy(0)).toEqual(['a1']);
    expect(renderedBy(1)).toEqual([]);

    setAppState('active');
    expect(rebuildReleasedSurfaces()).toBe(1);
    expect(recyclesOf(0)).toBe(0);
    expect(recyclesOf(1)).toBe(1);

    await post({ type: 'mapReady', workerId: 1 });
    expect(renderedBy(1)).toEqual(['a2']);
  });

  it('rebuilds at once after a native release that arrives in the foreground', async () => {
    setAppState('active');
    clearInjected();

    await post({ type: 'nativeMapReleased', workerId: 0 });

    expect(recyclesOf(0)).toBe(1);
    expect(rebuildReleasedSurfaces()).toBe(0);
  });

  it('waits for the feed to return before rebuilding a worker it released', async () => {
    await view.rerender(<TerrainSnapshotWebView ref={ref} suspended />);
    releaseMountedSurfaces();
    clearInjected();

    setAppState('active');
    rebuildReleasedSurfaces();
    expect(recyclesOf(0)).toBe(0);
    expect(recyclesOf(1)).toBe(0);

    await view.rerender(<TerrainSnapshotWebView ref={ref} suspended={false} />);

    expect(recyclesOf(0)).toBe(1);
    expect(recyclesOf(1)).toBe(1);
  });

  it('is forgotten by the registry once unmounted', async () => {
    await view.unmount();
    view = await render(<View />);

    expect(releaseMountedSurfaces()).toBe(0);
  });
});
