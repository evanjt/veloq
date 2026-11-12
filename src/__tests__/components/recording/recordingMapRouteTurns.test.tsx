/**
 * Scenario: the athlete follows a saved route and the map marks its turns on the line.
 *
 * Expected behaviour: each turn of the followed route is a point on the line, the one ahead of
 * the ride drawn as the accent. Nothing is followed, or the review map shows the route, and the
 * source and its layer stay mounted with no points.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { FfiFollowDirection, FfiFollowStatus } from 'veloqrs';

import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ preferences: { defaultStyle: 'light' } }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => true,
}));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let lastSources: Record<string, MapSourceSpec> = {};
let lastLayers: MapLayerSpec[] = [];

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    MapSurface: ReactLocal.forwardRef(
      (
        props: { sources: Record<string, MapSourceSpec>; layers: MapLayerSpec[] },
        _ref: unknown
      ) => {
        lastSources = props.sources;
        lastLayers = props.layers;
        return ReactLocal.createElement(View, { testID: 'maplibre-map' });
      }
    ),
  };
});

const HERE = { latitude: 46.948, longitude: 7.447 };
const FOLLOWED = {
  id: 'lake',
  name: 'Lake loop',
  distanceMeters: 12_400,
  bestTimeSeconds: null,
  points: [{ lat: 46.948, lng: 7.447 }],
};
const TURNS = [
  { alongM: 200, angleDeg: -90, lat: 46.9, lng: 7.4 },
  { alongM: 700, angleDeg: 90, lat: 46.91, lng: 7.41 },
];
const ON_ROUTE = {
  alongM: 500,
  remainingM: 11_900,
  crossTrackM: 3,
  routeBearingDeg: 0,
  bearingToRouteDeg: 0,
  status: FfiFollowStatus.OnRoute,
  direction: FfiFollowDirection.Forward,
  nextTurn: { alongM: 700, distanceM: 200, angleDeg: 90 },
};

function turnSource(): GeoJSON.FeatureCollection {
  return (lastSources['route-turns'] as { data: GeoJSON.FeatureCollection }).data;
}

beforeEach(() => {
  useRecordingLiveStore.getState().reset();
  lastSources = {};
  lastLayers = [];
});

describe('the followed route turns on the map', () => {
  it('marks each turn on the followed line, the one ahead of the ride as next', async () => {
    act(() => useRecordingLiveStore.setState({ routeTurns: TURNS, guidance: ON_ROUTE as never }));
    await render(
      <RecordingMap
        coordinates={[]}
        currentLocation={HERE}
        followedRoute={FOLLOWED}
        onStopFollowing={jest.fn()}
      />
    );

    expect(turnSource().features.map((f) => (f.geometry as GeoJSON.Point).coordinates)).toEqual([
      [7.4, 46.9],
      [7.41, 46.91],
    ]);
    expect(turnSource().features.map((f) => f.properties?.next)).toEqual([false, true]);
  });

  it('holds the source empty while nothing is followed, even with turns left in the store', async () => {
    act(() => useRecordingLiveStore.setState({ routeTurns: TURNS }));
    await render(<RecordingMap coordinates={[]} currentLocation={HERE} />);

    expect(lastSources['route-turns']).toBeDefined();
    expect(turnSource().features).toEqual([]);
  });

  it('holds the source empty on the review map', async () => {
    act(() => useRecordingLiveStore.setState({ routeTurns: TURNS }));
    await render(
      <RecordingMap
        coordinates={[]}
        currentLocation={null}
        followedRoute={FOLLOWED}
        fitBounds
        trimStart={0}
        trimEnd={0}
      />
    );

    expect(turnSource().features).toEqual([]);
  });

  it('draws the turns as circles from the followed line tone, with the next turn in the accent', async () => {
    await render(<RecordingMap coordinates={[]} currentLocation={HERE} />);

    const layer = lastLayers.find((l) => l.source === 'route-turns');
    expect(layer?.type).toBe('circle');
    expect(JSON.stringify(layer?.paint)).toContain('"next"');
  });
});
