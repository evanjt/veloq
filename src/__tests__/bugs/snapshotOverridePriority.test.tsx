/**
 * Scenario: the athlete holds one card and changes its map style or its 3D
 * mode. That is a direct instruction about the card they are looking at.
 *
 * Expected behaviour: the new render goes to the head of the queue rather than
 * behind every card the feed has mounted, and a full queue drops an ordinary
 * request instead of the one the athlete just asked for.
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
const injected: string[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<{
    injectJavaScript: (script: string) => void;
    reload: () => void;
  }>
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

const request = (activityId: string, over: Partial<SnapshotRequest> = {}): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 0, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat: true,
  ...over,
});

describe('an override jumps the snapshot queue', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const queue = (count: number) => {
    for (let i = 0; i < count; i += 1) pool().requestSnapshot(request(`a${i}`));
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockCached.clear();
    mockProgress.mockClear();
    injected.length = 0;
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not queue a stand-in already cached under the drape key', () => {
    mockCached.add('chosen_light_true');
    pool().requestSnapshot(request('chosen', { standIn: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).not.toContain('chosen');
  });

  it('drains a stand-in cached under the drape key while waiting', () => {
    pool().requestSnapshot(request('chosen', { standIn: true }));
    mockCached.add('chosen_light_true');
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).not.toContain('chosen');
    expect(mockProgress).toHaveBeenLastCalledWith({
      completed: 0,
      status: 'idle',
      total: 0,
    });
  });

  it('serves first paints before queued background terrain', () => {
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "visible"');
    expect(injected.join('\n')).not.toContain('activityId = "terrain"');
  });

  it('serves an override before a first paint and a background upgrade', () => {
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    pool().requestSnapshot(request('chosen', { priority: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "chosen"');
  });

  it('evicts background terrain before the oldest first paint', () => {
    queue(MAX_QUEUE_SIZE - 1);
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    pool().requestSnapshot(request('visible'));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "a0"');
  });

  it('drops an incoming upgrade when the queue is full of first paints', () => {
    queue(MAX_QUEUE_SIZE);
    pool().requestSnapshot(request('terrain', { flat: false, backgroundUpgrade: true }));
    post({ type: 'mapReady', workerId: 0 });
    expect(injected.join('\n')).toContain('activityId = "a0"');
  });

  it('renders the override first, ahead of everything already queued', () => {
    queue(5);
    pool().requestSnapshot(request('chosen', { priority: true }));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('chosen');
  });

  it('leaves an ordinary request where it was', () => {
    queue(5);
    pool().requestSnapshot(request('ordinary'));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('a0');
    expect(injected.join('\n')).not.toContain('ordinary');
  });

  it('drops an ordinary request when the queue is full, never the override', () => {
    queue(MAX_QUEUE_SIZE);
    pool().requestSnapshot(request('chosen', { priority: true }));

    post({ type: 'mapReady', workerId: 0 });

    expect(injected.join('\n')).toContain('chosen');
  });

  it('still counts the override in the total', () => {
    queue(3);
    pool().requestSnapshot(request('chosen', { priority: true }));

    const last = mockProgress.mock.calls[mockProgress.mock.calls.length - 1][0] as {
      total: number;
    };
    expect(last.total).toBe(4);
  });
});
