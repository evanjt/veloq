/**
 * Scenario: a feed card whose basemap snapshot is not on disk.
 *
 * Expected behaviour: three outcomes and no fourth. Waiting spins, a terminal
 * failure shows the same "nothing to draw" mark a card with no GPS gets, and
 * neither of them draws a route line. The Skia line was a second rendering
 * path kept alive for a case the failover ladder now makes rare, and Evan
 * decided on 2026-09-07 that it goes.
 *
 * A slow render is waiting, not failing: the card stays on the spinner until
 * the pipeline says it gave up.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

let mockSnapshotFailed: (() => void) | null = null;
let mockSnapshotDone: ((uri: string) => void) | null = null;

/** Cached renders by `activityId_style_is3D`, the triple the card asks with. */
const mockCached = new Set<string>();
const mockKey = (id: string, style: string, is3D: boolean) => `${id}_${style}_${is3D}`;

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'never',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: (id: string, style: string, is3D: boolean) =>
    mockCached.has(mockKey(id, style, is3D)),
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///cached.jpg',
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
  deleteTerrainPreview: jest.fn(async (id: string, style: string, is3D: boolean) => {
    mockCached.delete(mockKey(id, style, is3D));
  }),
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: (_id: string, cb: (uri: string) => void) => {
    mockSnapshotDone = cb;
    return () => {};
  },
  subscribeSnapshotFailure: (_id: string, cb: () => void) => {
    mockSnapshotFailed = cb;
    return () => {};
  },
}));

const SWISS_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
  { longitude: 8.74, latitude: 47.54 },
];

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({
    coordinates: SWISS_TRACK,
    altitude: [],
    isLoading: false,
  }),
}));

const activity = {
  id: 'demo-1',
  type: 'Ride',
  stream_types: ['latlng'],
} as unknown as Activity;

/** Every Skia primitive the deleted route line drew. */
const SKIA_NODES = ['skia-canvas', 'Canvas', 'Path', 'Circle'];

function skiaNodeCount(tree: Awaited<ReturnType<typeof render>>): number {
  const json = JSON.stringify(tree.toJSON());
  return SKIA_NODES.filter((n) => json.includes(`"${n}"`)).length;
}

describe('a feed card with no preview draws no route line', () => {
  beforeEach(() => {
    mockSnapshotFailed = null;
    mockCached.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('spins while the render is pending', async () => {
    const tree = await render(<ActivityMapPreview activity={activity} />);

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
    expect(skiaNodeCount(tree)).toBe(0);
  });

  it('keeps spinning when the render is merely slow, rather than calling it failed', async () => {
    const tree = await render(<ActivityMapPreview activity={activity} />);

    await act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
    expect(skiaNodeCount(tree)).toBe(0);
  });

  it('shows the no-map mark once the pipeline says it gave up, and never a line', async () => {
    const tree = await render(<ActivityMapPreview activity={activity} />);

    await act(() => {
      mockSnapshotFailed?.();
    });

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
    expect(skiaNodeCount(tree)).toBe(0);
    const icons = tree.UNSAFE_getAllByType(MaterialCommunityIcons);
    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('map-marker-off');
  });
});

describe('a cached preview that will not decode', () => {
  const { ActivityIndicator, Image } = require('react-native');

  beforeEach(() => {
    mockSnapshotFailed = null;
    mockSnapshotDone = null;
    mockCached.clear();
    mockCached.add(mockKey('demo-1', 'light', false));
  });

  async function renderCachedCard() {
    const requestSnapshot = jest.fn();
    const snapshotRef = {
      current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
    };
    const tree = await render(
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    );
    return { requestSnapshot, tree };
  }

  async function failImage(tree: Awaited<ReturnType<typeof render>>) {
    await act(() => {
      tree.UNSAFE_getByType(Image).props.onError({ nativeEvent: { error: 'decode failed' } });
    });
  }

  it('drops the broken entry from the cache', async () => {
    const { tree } = await renderCachedCard();

    await failImage(tree);

    const { deleteTerrainPreview } = require('@/features/maps/lib/storage/terrainPreviewCache');
    expect(deleteTerrainPreview).toHaveBeenCalledWith('demo-1', 'light', false);
    expect(mockCached.has(mockKey('demo-1', 'light', false))).toBe(false);
  });

  it('asks the pool to draw it again, so the spinner has something to wait for', async () => {
    const { requestSnapshot, tree } = await renderCachedCard();
    expect(requestSnapshot).not.toHaveBeenCalled();

    await failImage(tree);

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(requestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: 'demo-1', mapStyle: 'light' })
    );
  });

  it('takes the no-map mark when the redrawn image fails too, rather than asking forever', async () => {
    const { requestSnapshot, tree } = await renderCachedCard();
    await failImage(tree);
    await act(() => {
      mockCached.add(mockKey('demo-1', 'light', false));
      mockSnapshotDone?.('file:///redrawn.jpg');
    });

    await failImage(tree);

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
    expect(tree.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    const icons = tree.UNSAFE_getAllByType(MaterialCommunityIcons);
    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('map-marker-off');
  });
});
