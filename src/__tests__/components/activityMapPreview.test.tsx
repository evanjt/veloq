/**
 * Scenario: a feed card showing a cached basemap snapshot.
 * Expected behaviour: the snapshot is tile imagery, so it carries the same
 * credit line a live map does. The generator draws none into the image, so the
 * card overlays it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { Activity } from '@/types';

let mockMapStyle = 'light';

// react-native-iap reaches for NitroModules at import time, and the shared UI
// barrel pulls it in transitively.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => mockMapStyle,
    getTerrain3DMode: () => 'never',
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => true,
  getTerrainPreviewUri: () => 'file:///snapshots/demo-1-light.png',
  isTerrainPreviewDirty: () => false,
  clearTerrainPreviewDirty: jest.fn(),
  deleteTerrainPreviewsForActivity: jest.fn(),
  isPrioritySnapshot: () => false,
  clearPrioritySnapshot: jest.fn(),
  isTerrainCacheInitialized: () => true,
  onTerrainCacheReady: () => () => {},
}));

jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  getCameraOverride: () => null,
}));

jest.mock('@/features/maps/lib/terrainSnapshotEvents', () => ({
  subscribeSnapshot: () => () => {},
  subscribeSnapshotFailure: () => () => {},
}));

const SWISS_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
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
  distance: 42000,
  total_elevation_gain: 300,
  stream_types: ['latlng'],
} as unknown as Activity;

describe('ActivityMapPreview', () => {
  beforeEach(() => {
    mockMapStyle = 'light';
  });

  it('credits the basemap under the cached snapshot', () => {
    const { getByTestId } = render(<ActivityMapPreview activity={activity} />);

    expect(getByTestId('map-attribution-text').props.children).toBe(
      '© OpenFreeMap © OpenMapTiles © OpenStreetMap'
    );
  });

  it('names the regional satellite sources the snapshot camera covers', () => {
    mockMapStyle = 'satellite';

    const { getByTestId } = render(<ActivityMapPreview activity={activity} />);

    const text = getByTestId('map-attribution-text').props.children as string;
    expect(text).toContain('swisstopo');
    expect(text).toContain('EOX');
  });
});
