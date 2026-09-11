/**
 * Scenario: a feed card holding a flat stand-in for a drape that timed out.
 *
 * Expected behaviour: the stand-in is on screen from the first frame, since a
 * card is never blanked to redraw it, and the card asks the pool for the drape
 * anyway, marked as an upgrade so the pool can cap it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));

/** The drape the card wants, against the flat stand-in it holds. */
let mockDowngraded = true;

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'always',
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => true,
  isTerrainPreviewDowngraded: () => mockDowngraded,
  getTerrainPreviewUri: () => 'file:///standin.jpg',
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
  subscribeSnapshotFailure: () => () => {},
}));

const ALPINE_TRACK = [
  { longitude: 8.7, latitude: 47.5 },
  { longitude: 8.72, latitude: 47.52 },
  { longitude: 8.74, latitude: 47.56 },
];

jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMapPreviewCoordinates: () => ({
    coordinates: ALPINE_TRACK,
    altitude: [400, 900, 1500],
    isLoading: false,
  }),
}));

const activity = {
  id: 'demo-1',
  type: 'Ride',
  country: 'Switzerland',
  stream_types: ['latlng'],
} as unknown as Activity;

function renderCard() {
  const requestSnapshot = jest.fn();
  const snapshotRef = { current: { requestSnapshot, retryFailed: jest.fn() } };
  const tree = render(
    <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
  );
  return { requestSnapshot, tree };
}

describe('a card holding a stand-in serves it and still asks for the real one', () => {
  afterEach(() => {
    mockDowngraded = true;
  });

  it('asks again, marked as an upgrade', () => {
    const { requestSnapshot } = renderCard();

    expect(requestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ activityId: 'demo-1', upgrade: true })
    );
  });

  it('keeps the stand-in on screen while it asks', () => {
    const { tree } = renderCard();

    expect(tree.getByTestId('activity-map-preview-ready-demo-1')).toBeTruthy();
  });

  it('asks for nothing once it holds the render it wanted', () => {
    mockDowngraded = false;

    const { requestSnapshot } = renderCard();

    expect(requestSnapshot).not.toHaveBeenCalled();
  });
});
