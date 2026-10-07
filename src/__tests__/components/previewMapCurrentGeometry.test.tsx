/**
 * Scenario: a finished run holds a changed section whose proposed line differs
 * from the live one.
 * Expected behaviour: the current layer draws the live line and the proposed
 * layer draws the proposed one, so the two never sit on top of each other.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import type { PreviewResult, PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

const capturedSources: Record<string, { data: GeoJSON.FeatureCollection }>[] = [];

// The first byte of the buffer picks the line, so each catalogue's geometry is distinct.
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: (buf: ArrayBuffer) => {
      const base = new Uint8Array(buf)[0];
      return [
        { longitude: base, latitude: 47.5 },
        { longitude: base + 0.01, latitude: 47.51 },
      ];
    },
  })
);

jest.mock('@/features/maps', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@/features/maps'),
    MapSurface: ({ sources }: { sources: Record<string, { data: GeoJSON.FeatureCollection }> }) => {
      capturedSources.push(sources);
      return <View testID="map-surface" />;
    },
  };
});

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function section(id: string, line: number, over: Partial<PreviewSection> = {}): PreviewSection {
  return {
    id,
    liveId: id,
    status: 'changed',
    name: `Section ${id}`,
    polyline: new Uint8Array([line]).buffer,
    visits: 7,
    distanceM: 4200,
    elevationGainM: 88,
    avgGradePercent: 2.1,
    pinned: false,
    ...over,
  };
}

const RESULT: PreviewResult = {
  pool: { activities: 4, empty: 0, unreadable: 0 },
  elapsedMs: 9,
  config: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 10000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
  counts: { current: 2, proposed: 2, unchanged: 0, changed: 1, new: 1, gone: 0 },
  sections: [
    section('p-1', 9, { liveId: 'l-1' }),
    section('p-2', 7, { liveId: 'missing', status: 'unchanged' }),
  ],
};

function renderMap() {
  render(
    <PreviewMapView
      result={RESULT}
      currentSections={[section('l-1', 8)]}
      centre={{ lat: 47.5, lng: 8.7 }}
      selectedId={null}
      showCurrent
      showProposed
      showRemoved
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={jest.fn()}
    />
  );
  return capturedSources[capturedSources.length - 1];
}

describe('PreviewMapView current geometry after a run', () => {
  beforeEach(() => {
    capturedSources.length = 0;
  });

  it('draws a matched row’s live line in current and its proposed line in proposed', () => {
    const sources = renderMap();
    const current = sources['current-sections'].data.features;
    const proposed = sources['proposed-sections'].data.features;
    expect(current).toHaveLength(1);
    expect((current[0].geometry as GeoJSON.LineString).coordinates[0][0]).toBe(8);
    expect(current[0].properties?.id).toBe('p-1');
    expect(proposed.map((f) => (f.geometry as GeoJSON.LineString).coordinates[0][0])).toEqual([
      9, 7,
    ]);
  });

  it('draws no current line for a live id the catalogue does not hold', () => {
    const sources = renderMap();
    expect(sources['current-sections'].data.features.map((f) => f.properties?.id)).not.toContain(
      'p-2'
    );
  });
});
