/**
 * Scenario: the live screen hands the map the store's own track, which grows in
 * place, with the length each render saw.
 * Expected behaviour: each fix reaches the page as the one point it added, and
 * the line the map holds is the whole flipped track.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { createSurfacePatcher } from '@/features/maps/lib/mapSurfacePatch';
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

const patches: ReturnType<ReturnType<typeof createSurfacePatcher>['next']>[] = [];
let lastSources: Record<string, MapSourceSpec> = {};

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const { createSurfacePatcher: create } = require('@/features/maps/lib/mapSurfacePatch');
  const patcher = create();
  return {
    MapSurface: ReactLocal.forwardRef(
      (props: { sources: Record<string, MapSourceSpec>; layers: unknown[] }, _ref: unknown) => {
        lastSources = props.sources;
        patches.push(patcher.next({ sources: props.sources, layers: props.layers }));
        return ReactLocal.createElement(View, { testID: 'maplibre-map' });
      }
    ),
  };
});

function routeLine(): number[][] {
  const data = (lastSources['recording-route'] as { data: GeoJSON.FeatureCollection }).data;
  const feature = data.features[0] as GeoJSON.Feature<GeoJSON.LineString>;
  return feature.geometry.coordinates;
}

describe('the live line on the recording map', () => {
  it('ships one fix as one point from a track that grows in place', () => {
    const track: [number, number][] = [
      [46.948, 7.447],
      [46.949, 7.448],
    ];
    const here = { latitude: 46.949, longitude: 7.448 };
    const view = render(
      <RecordingMap coordinates={track} coordinateCount={2} currentLocation={here} />
    );

    track.push([46.95, 7.449]);
    view.rerender(<RecordingMap coordinates={track} coordinateCount={3} currentLocation={here} />);
    expect(patches[patches.length - 1].patch?.appends).toEqual({
      'recording-route': [[7.449, 46.95]],
    });

    track.push([46.951, 7.45]);
    view.rerender(<RecordingMap coordinates={track} coordinateCount={4} currentLocation={here} />);
    expect(patches[patches.length - 1].patch?.appends).toEqual({
      'recording-route': [[7.45, 46.951]],
    });
    expect(routeLine()).toEqual([
      [7.447, 46.948],
      [7.448, 46.949],
      [7.449, 46.95],
      [7.45, 46.951],
    ]);
  });

  it('draws only the length the render saw, not points added after it', () => {
    const track: [number, number][] = [
      [46.948, 7.447],
      [46.949, 7.448],
      [46.95, 7.449],
    ];
    render(<RecordingMap coordinates={track} coordinateCount={2} currentLocation={null} />);
    expect(routeLine()).toHaveLength(2);
  });

  it('draws no line to the origin for samples with no position', () => {
    const track: [number, number][] = [
      [0, 0],
      [0, 0],
      [46.948, 7.447],
      [46.949, 7.448],
    ];
    render(<RecordingMap coordinates={track} currentLocation={null} />);
    expect(routeLine()).toEqual([
      [7.447, 46.948],
      [7.448, 46.949],
    ]);
  });

  it('applies a trim in track indices when placeholders precede the trimmed range', () => {
    const track: [number, number][] = [
      [0, 0],
      [46.948, 7.447],
      [46.949, 7.448],
      [46.95, 7.449],
      [46.951, 7.45],
    ];
    render(
      <RecordingMap
        coordinates={track}
        currentLocation={null}
        fitBounds
        trimStart={2}
        trimEnd={3}
      />
    );
    expect(routeLine()).toEqual([
      [7.448, 46.949],
      [7.449, 46.95],
    ]);
  });
});
