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
import type { FeedCard } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'never',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => 'file:///nothing.jpg',
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
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

function activity(hasGps: boolean): FeedCard {
  return { id: 'demo-1', sportType: 'Ride', hasGps } as FeedCard;
}

/** The single icon the placeholder draws. */
function markOf(tree: Awaited<ReturnType<typeof render>>): string {
  const icons = tree.UNSAFE_getAllByType(MaterialCommunityIcons);
  expect(icons).toHaveLength(1);
  return icons[0].props.name;
}

beforeEach(() => {
  read.coordinates = [];
  read.isLoading = false;
});

describe('a feed card whose track has not been downloaded', () => {
  it('draws the download-pending mark, not the no-GPS one', async () => {
    const tree = await render(<ActivityMapPreview activity={activity(true)} />);

    expect(markOf(tree)).toBe('cloud-download-outline');
  });

  /** An indoor session has no track upstream and never will, which is settled. */
  it('keeps the no-GPS mark for an activity the server says has no track', async () => {
    const tree = await render(<ActivityMapPreview activity={activity(false)} />);

    expect(markOf(tree)).toBe('map-marker-off');
  });

  /** A read still in flight is waiting, and waiting spins. */
  it('spins while the track read is still in flight', async () => {
    read.isLoading = true;
    const tree = await render(<ActivityMapPreview activity={activity(true)} />);

    expect(tree.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(1);
  });
});
