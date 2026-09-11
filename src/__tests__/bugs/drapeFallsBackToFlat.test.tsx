/**
 * Scenario: an athlete with terrain on, scrolling a feed on a connection that
 * cannot fetch terrain tiles. Every drape request runs out of retries.
 *
 * Expected behaviour: the card gets the flat basemap it could always have
 * drawn, saved as a stand-in so the fact it is not the render that was asked
 * for survives a restart. A flat render that fails has nowhere left to go and
 * is filed as a failure, as it is today.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TerrainSnapshotWebView,
  fallbackRequest,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

const injected: string[] = [];
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
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
  }));
  return <View />;
});

const mockSave = jest.fn(async () => 'file:///snap.jpg');
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  saveTerrainPreview: (...args: unknown[]) => mockSave(...(args as [])),
}));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: () => 64,
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: {
    getState: () => ({ setTerrainSnapshotProgress: () => {} }),
  },
}));

const request = (activityId: string, flat: boolean): SnapshotRequest => ({
  activityId,
  coordinates: [
    [8.7, 47.5],
    [8.72, 47.52],
  ],
  camera: { center: [8.71, 47.51], zoom: 12, pitch: 60, bearing: 0 },
  mapStyle: 'light',
  routeColor: '#ff0000',
  flat,
});

/** Already at the last rung, so one error exhausts it with no in-flight retry. */
const exhausted = (activityId: string, flat: boolean): SnapshotRequest => ({
  ...request(activityId, flat),
  _retryAttempt: 1,
});

/** Whether the script handed to a worker draws flat or the drape. */
const rendersFlat = (script: string) => /var isFlat = true/.test(script);

describe('the decision to fall back', () => {
  it('sends an exhausted drape to flat, once', () => {
    const fallback = fallbackRequest(request('a1', false));

    expect(fallback).toMatchObject({ activityId: 'a1', flat: true, standIn: true });
    expect(fallback?._retryAttempt).toBe(0);
  });

  it('has nowhere to send an exhausted flat render', () => {
    expect(fallbackRequest(request('a1', true))).toBeNull();
  });

  it('does not send a stand-in back round again', () => {
    const once = fallbackRequest(request('a1', false));

    expect(fallbackRequest(once as SnapshotRequest)).toBeNull();
  });

  it('keeps the camera and the track, so the flat render is of the same ride', () => {
    const original = request('a1', false);

    expect(fallbackRequest(original)).toMatchObject({
      coordinates: original.coordinates,
      camera: original.camera,
      mapStyle: original.mapStyle,
      routeColor: original.routeColor,
    });
  });
});

describe('the pool draws the flat basemap when the drape runs out', () => {
  let ref: React.RefObject<TerrainSnapshotWebViewRef | null>;

  const pool = () => {
    if (!ref.current) throw new Error('the pool did not mount');
    return ref.current;
  };

  const failOnWorkerOne = (activityId: string, flat: boolean) => {
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
    mockSave.mockClear();
    ref = React.createRef<TerrainSnapshotWebViewRef>();
    render(<TerrainSnapshotWebView ref={ref} />);
    onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady', workerId: 0 }) } });
    onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady', workerId: 1 }) } });
    // Hold worker 0, so the one under test is worker 1 throughout.
    pool().requestSnapshot(exhausted('held', true));
    injected.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-renders the same activity flat', () => {
    failOnWorkerOne('a1', false);
    jest.advanceTimersByTime(2000);

    const drawn = injected.filter((s) => s.includes("activityId = 'a1'"));
    expect(drawn.length).toBeGreaterThan(0);
    expect(rendersFlat(drawn[drawn.length - 1])).toBe(true);
  });

  it('leaves a failed flat render alone', () => {
    failOnWorkerOne('a2', true);
    jest.advanceTimersByTime(2000);

    // One script, the request itself. A flat render has no rung below it, so
    // nothing draws it a second time.
    expect(injected.filter((s) => s.includes("activityId = 'a2'"))).toHaveLength(1);
  });

  const landOnWorkerOne = async (activityId: string) => {
    onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          type: 'snapshot',
          workerId: 1,
          activityId,
          mapStyle: 'light',
          base64: 'bytes',
        }),
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
  };

  it('brings a stood-in card back when another drape renders', async () => {
    failOnWorkerOne('a4', false);
    jest.advanceTimersByTime(2000);
    await landOnWorkerOne('a4');
    injected.length = 0;

    // Another card's drape lands, which is the proof the host is answering.
    pool().requestSnapshot(request('a5', false));
    await landOnWorkerOne('a5');

    const redrawn = injected.filter((s) => s.includes("activityId = 'a4'"));
    expect(redrawn).toHaveLength(1);
    expect(rendersFlat(redrawn[0])).toBe(false);
  });

  it('does not bring it back when the render that landed was the stand-in itself', async () => {
    failOnWorkerOne('a6', false);
    jest.advanceTimersByTime(2000);
    injected.length = 0;

    await landOnWorkerOne('a6');

    expect(injected.filter((s) => s.includes("activityId = 'a6'"))).toHaveLength(0);
  });

  it('saves the stand-in under the drape it was asked for', async () => {
    failOnWorkerOne('a3', false);
    jest.advanceTimersByTime(2000);

    onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          type: 'snapshot',
          workerId: 1,
          activityId: 'a3',
          mapStyle: 'light',
          base64: 'bytes',
        }),
      },
    });
    await Promise.resolve();

    expect(mockSave).toHaveBeenCalledWith('a3', 'light', true, 'bytes', { downgradedTo: 'flat' });
  });
});
