/**
 * Scenario: a preview run where removals dominate, 89 removed against 29 kept.
 * Expected behaviour: the removed catalogue is most of what the map draws, so
 * it toggles on its own rather than riding on the Current chip. Hiding the
 * current catalogue leaves the removals drawn, and hiding the removals leaves
 * the current catalogue drawn.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import type { PreviewResult, PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

const capturedSources: Record<string, { data: GeoJSON.FeatureCollection }>[] = [];

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 8.7, latitude: 47.5 },
      { longitude: 8.71, latitude: 47.51 },
    ],
  })
);

jest.mock('@/features/maps/components', () => {
  const { View } = require('react-native');
  return {
    ...require('@/features/maps/components/AttributionOverlay'),
    MapSurface: ({ sources }: { sources: Record<string, { data: GeoJSON.FeatureCollection }> }) => {
      capturedSources.push(sources);
      return <View testID="map-surface" />;
    },
  };
});

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => 'light' }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const CENTRE = { binKey: '9:27', lat: 47.5, lng: 8.7 };

function section(id: string, over: Partial<PreviewSection> = {}): PreviewSection {
  return {
    id,
    liveId: id,
    status: 'unchanged',
    name: `Section ${id}`,
    sport: 'Ride',
    polylineBase64: 'AAAA',
    visits: 7,
    distanceM: 4200,
    elevationGainM: 88,
    avgGradePercent: 2.1,
    pinned: false,
    ...over,
  };
}

const RESULT: PreviewResult = {
  pool: { activities: 10, empty: 0, unreadable: 0 },
  elapsedMs: 12,
  config: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 10000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
  counts: { current: 2, proposed: 1, unchanged: 1, changed: 0, new: 0, gone: 1 },
  sections: [section('kept'), section('dropped', { status: 'gone' })],
};

function renderMap(over: { showCurrent?: boolean; showRemoved?: boolean } = {}) {
  capturedSources.length = 0;
  render(
    <PreviewMapView
      result={RESULT}
      currentSections={[]}
      centre={CENTRE}
      selectedId={null}
      showCurrent={over.showCurrent ?? true}
      showProposed
      showRemoved={over.showRemoved ?? true}
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={jest.fn()}
    />
  );
  return capturedSources[capturedSources.length - 1];
}

function count(sources: Record<string, { data: GeoJSON.FeatureCollection }>, id: string) {
  return sources[id].data.features.length;
}

describe('the removed catalogue toggle', () => {
  it('draws a removed line once, through its own layer', () => {
    const sources = renderMap();

    expect(count(sources, 'gone-sections')).toBe(1);
    expect(count(sources, 'current-sections')).toBe(1);
    expect(count(sources, 'proposed-sections')).toBe(1);
  });

  it('keeps removals drawn when the current catalogue is hidden', () => {
    const sources = renderMap({ showCurrent: false });

    expect(count(sources, 'gone-sections')).toBe(1);
    expect(count(sources, 'current-sections')).toBe(0);
  });

  it('hides removals on their own, leaving the current catalogue drawn', () => {
    const sources = renderMap({ showRemoved: false });

    expect(count(sources, 'gone-sections')).toBe(0);
    expect(count(sources, 'current-sections')).toBe(1);
  });
});
