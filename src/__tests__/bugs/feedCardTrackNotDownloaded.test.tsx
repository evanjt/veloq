/**
 * Scenario: scroll the feed back past whatever the device has ingested. Every
 * ride there carries `latlng` in its `stream_types`, so the server says it has
 * a track, and the preview has no coordinates for it yet.
 *
 * Expected behaviour: that draws the download-pending mark, not the no-GPS one.
 * An indoor session with no track and a ride one sync away were the same
 * picture, and only the first of them is ever going to change.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

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
  isTerrainCacheInitialized: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  getCameraOverride: () => null,
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: () => () => {},
  subscribeSnapshotFailure: () => () => {},
}));

const read: { coordinates: { longitude: number; latitude: number }[]; isLoading: boolean } = {
  coordinates: [],
  isLoading: false,
};

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({
    coordinates: read.coordinates,
    altitude: [],
    isLoading: read.isLoading,
  }),
}));

function activity(streamTypes: string[]): Activity {
  return {
    id: 'demo-1',
    type: 'Ride',
    stream_types: streamTypes,
  } as unknown as Activity;
}

/** The single icon the placeholder draws. */
function markOf(tree: ReturnType<typeof render>): string {
  const icons = tree.UNSAFE_getAllByType(MaterialCommunityIcons);
  expect(icons).toHaveLength(1);
  return icons[0].props.name;
}

beforeEach(() => {
  read.coordinates = [];
  read.isLoading = false;
});

describe('a feed card whose track has not been downloaded', () => {
  it('draws the download-pending mark, not the no-GPS one', () => {
    const tree = render(<ActivityMapPreview activity={activity(['latlng'])} />);

    expect(markOf(tree)).toBe('cloud-download-outline');
  });

  /** An indoor session has no track upstream and never will, which is settled. */
  it('keeps the no-GPS mark for an activity the server says has no track', () => {
    const tree = render(<ActivityMapPreview activity={activity(['heartrate'])} />);

    expect(markOf(tree)).toBe('map-marker-off');
  });

  /** `stream_types` absent is the same ignorance as an empty list, not a claim. */
  it('keeps the no-GPS mark when the server named no streams at all', () => {
    const tree = render(<ActivityMapPreview activity={activity([])} />);

    expect(markOf(tree)).toBe('map-marker-off');
  });

  /** A read still in flight is waiting, and waiting spins. */
  it('spins while the track read is still in flight', () => {
    read.isLoading = true;
    const tree = render(<ActivityMapPreview activity={activity(['latlng'])} />);

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
  });
});
