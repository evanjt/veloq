/**
 * Scenario: the entry screen draws the fix's accuracy on the ground around the
 * position while GPS acquires.
 * Expected behaviour: the ring is a polygon of that radius around the dot, and
 * with no accuracy the source stays mounted with nothing in it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RecordingMap } from '@/features/recording/components/RecordingMap';
import type { MapSourceSpec } from '@/features/maps';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ preferences: { defaultStyle: 'light' } }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => true,
}));

let lastSources: Record<string, MapSourceSpec> = {};

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    MapSurface: ReactLocal.forwardRef(
      (props: { sources: Record<string, MapSourceSpec> }, _ref: unknown) => {
        lastSources = props.sources;
        return ReactLocal.createElement(View, { testID: 'maplibre-map' });
      }
    ),
  };
});

const HERE = { latitude: 46.948, longitude: 7.447 };
const METRES_PER_DEGREE_LAT = 111_195;

function ring(): GeoJSON.FeatureCollection {
  return (lastSources['current-accuracy'] as { data: GeoJSON.FeatureCollection }).data;
}

describe('the accuracy ring', () => {
  it('surrounds the position at the fix accuracy', () => {
    render(<RecordingMap coordinates={[]} currentLocation={HERE} accuracy={30} />);

    const polygon = ring().features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
    const lats = polygon.geometry.coordinates[0].map(([, lat]) => lat);
    const northM = (Math.max(...lats) - HERE.latitude) * METRES_PER_DEGREE_LAT;
    expect(northM).toBeCloseTo(30, 0);
  });

  it('keeps the source mounted and empty with no accuracy or no position', () => {
    const view = render(<RecordingMap coordinates={[]} currentLocation={HERE} />);
    expect(ring().features).toEqual([]);

    view.rerender(<RecordingMap coordinates={[]} currentLocation={null} accuracy={30} />);
    expect(ring().features).toEqual([]);
  });
});
