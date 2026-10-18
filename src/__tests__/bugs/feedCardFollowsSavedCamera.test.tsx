/**
 * Scenario: a feed card already drawn in 3D, and the athlete saves a new
 * camera angle for that activity from its detail view.
 *
 * Expected behaviour: the card asks for a render from the saved angle, and
 * after an undo asks again from the angle it had, without anything else about
 * the activity's map changing.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ActivityMapPreview } from '@/features/activity/components/ActivityMapPreview';
import { useActivityMapChoices } from '@/features/activity/hooks/useActivityMapChoices';
import { MapPreferencesProvider, useMapPreferences } from '@/features/settings';
import { forgetCameraOverrides } from '@/features/maps/lib/storage/terrainCameraOverrides';
import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';
import type { FeedCard } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  getTerrainPreviewUri: () => null,
  isTerrainCacheInitialised: () => true,
  onTerrainCacheReady: () => () => {},
  deleteSupersededTerrainPreviews: jest.fn(),
  deleteTerrainPreviewsForActivity: jest.fn(async () => {}),
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
  id: 'climb-7',
  sportType: 'Ride',
  distance: 9000,
  elevationGain: 1100,
  hasGps: true,
} as FeedCard;

const SAVED_ANGLE: TerrainCamera = { center: [8.73, 47.54], zoom: 13.4, bearing: 210, pitch: 70 };

let choices: ReturnType<typeof useActivityMapChoices>;
let loaded = false;

function Detail({
  report,
}: {
  report: (current: ReturnType<typeof useActivityMapChoices>, isLoaded: boolean) => void;
}) {
  report(useActivityMapChoices(activity.id), useMapPreferences().isLoaded);
  return null;
}

async function renderFeed() {
  const requestSnapshot = jest.fn();
  const snapshotRef = {
    current: { requestSnapshot, retryFailed: jest.fn(), holdForScroll: jest.fn() },
  };
  await render(
    <MapPreferencesProvider>
      <Detail
        report={(current, isLoaded) => {
          choices = current;
          loaded = isLoaded;
        }}
      />
      <ActivityMapPreview activity={activity} snapshotRef={snapshotRef} snapshotReady={true} />
    </MapPreferencesProvider>
  );
  return requestSnapshot;
}

const lastCamera = (requestSnapshot: jest.Mock) =>
  requestSnapshot.mock.calls[requestSnapshot.mock.calls.length - 1]?.[0]?.camera;

describe('a 3D feed card after a camera angle is saved', () => {
  beforeEach(async () => {
    loaded = false;
    await forgetCameraOverrides();
  });

  it('asks for a render from the saved angle', async () => {
    const requestSnapshot = await renderFeed();
    await waitFor(() => expect(loaded).toBe(true));
    await waitFor(() => expect(requestSnapshot).toHaveBeenCalled());
    const autoAngle = lastCamera(requestSnapshot);
    expect(autoAngle).not.toEqual(SAVED_ANGLE);

    await act(async () => choices.onCameraCapture(SAVED_ANGLE));

    await waitFor(() => expect(lastCamera(requestSnapshot)).toEqual(SAVED_ANGLE));
    expect(requestSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ activityId: activity.id, cameraPinned: true })
    );

    await act(async () => choices.undoCameraCapture());

    await waitFor(() => expect(lastCamera(requestSnapshot)).toEqual(autoAngle));
  });
});
