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
jest.mock('expo-router', () => ({ useIsFocused: () => true }));

let mockSnapshotFailed: (() => void) | null = null;

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'never',
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///nothing.jpg',
  isPrioritySnapshot: () => false,
  clearPrioritySnapshot: jest.fn(),
  isTerrainCacheInitialized: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  getCameraOverride: () => null,
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: () => () => {},
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
  country: 'Switzerland',
  stream_types: ['latlng'],
} as unknown as Activity;

/** Every Skia primitive the deleted route line drew. */
const SKIA_NODES = ['skia-canvas', 'Canvas', 'Path', 'Circle'];

function skiaNodeCount(tree: ReturnType<typeof render>): number {
  const json = JSON.stringify(tree.toJSON());
  return SKIA_NODES.filter((n) => json.includes(`"${n}"`)).length;
}

describe('a feed card with no preview draws no route line', () => {
  beforeEach(() => {
    mockSnapshotFailed = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('spins while the render is pending', () => {
    const tree = render(<ActivityMapPreview activity={activity} />);

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
    expect(skiaNodeCount(tree)).toBe(0);
  });

  it('keeps spinning when the render is merely slow, rather than calling it failed', () => {
    const tree = render(<ActivityMapPreview activity={activity} />);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
    expect(skiaNodeCount(tree)).toBe(0);
  });

  it('shows the no-map mark once the pipeline says it gave up, and never a line', () => {
    const tree = render(<ActivityMapPreview activity={activity} />);

    act(() => {
      mockSnapshotFailed?.();
    });

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
    expect(skiaNodeCount(tree)).toBe(0);
    const icons = tree.UNSAFE_getAllByType(MaterialCommunityIcons);
    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('map-marker-off');
  });
});
