/**
 * Scenario: the preview map before and after a run.
 * Expected behaviour: with no result the live catalogue draws as current
 * alone, so nothing reads as proposed until something has been proposed. A
 * finished run supersedes it, and tapping a line resolves against whichever
 * catalogue is on screen.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import type { PreviewResult, PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

const capturedSources: Record<string, { data: GeoJSON.FeatureCollection }>[] = [];

jest.mock('veloqrs', () => ({
  decodeCoords: () => [
    { longitude: 8.7, latitude: 47.5 },
    { longitude: 8.71, latitude: 47.51 },
  ],
}));

jest.mock('@/features/maps/components', () => {
  const { View } = require('react-native');
  return {
    // The real overlay, so the credit line under test is the shipped one.
    ...require('@/features/maps/components/AttributionOverlay'),
    MapSurface: ({ sources }: { sources: Record<string, { data: GeoJSON.FeatureCollection }> }) => {
      capturedSources.push(sources);
      return <View testID="map-surface" />;
    },
  };
});

let mockGlobalMapStyle = 'light';

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => mockGlobalMapStyle }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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

function latestSources() {
  return capturedSources[capturedSources.length - 1];
}

function featureIds(collection: GeoJSON.FeatureCollection) {
  return collection.features.map((f) => f.properties?.id);
}

const CENTRE = { lat: 47.5, lng: 8.7 };

describe('PreviewMapView', () => {
  beforeEach(() => {
    capturedSources.length = 0;
    mockGlobalMapStyle = 'light';
  });

  it('draws the live catalogue as current alone before a run', () => {
    render(
      <PreviewMapView
        result={null}
        currentSections={[section('live-a'), section('live-b')]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    const sources = latestSources();
    expect(featureIds(sources['current-sections'].data)).toEqual(['live-a', 'live-b']);
    expect(sources['proposed-sections'].data.features).toEqual([]);
    expect(sources['gone-sections'].data.features).toEqual([]);
  });

  it('draws nothing when the area has no sections yet', () => {
    render(
      <PreviewMapView
        result={null}
        currentSections={[]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    const sources = latestSources();
    expect(sources['current-sections'].data.features).toEqual([]);
    expect(sources['proposed-sections'].data.features).toEqual([]);
  });

  it('hides the live catalogue when the current chip is off', () => {
    render(
      <PreviewMapView
        result={null}
        currentSections={[section('live-a')]}
        centre={CENTRE}
        selectedId={null}
        showCurrent={false}
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(latestSources()['current-sections'].data.features).toEqual([]);
  });

  it('lets a finished run supersede the live catalogue', () => {
    const result: PreviewResult = {
      pool: { activities: 4, empty: 0, unreadable: 0 },
      elapsedMs: 9,
      config: {
        proximityThreshold: 50,
        minSectionLength: 500,
        maxSectionLength: 10000,
        minActivities: 3,
        divergenceThreshold: 0.2,
      },
      counts: {
        current: 1,
        proposed: 1,
        unchanged: 0,
        changed: 0,
        new: 1,
        gone: 1,
      },
      sections: [
        section('proposed-a', { liveId: null, status: 'new' }),
        section('live-b', { liveId: null, status: 'gone' }),
      ],
    };

    render(
      <PreviewMapView
        result={result}
        currentSections={[section('live-a'), section('live-b')]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    const sources = latestSources();
    expect(featureIds(sources['proposed-sections'].data)).toEqual(['proposed-a']);
    expect(featureIds(sources['gone-sections'].data)).toEqual(['live-b']);
    expect(sources['current-sections'].data.features).toEqual([]);
  });

  it('selects out of the live catalogue before a run', () => {
    render(
      <PreviewMapView
        result={null}
        currentSections={[section('live-a')]}
        centre={CENTRE}
        selectedId="live-a"
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(featureIds(latestSources()['selected-section'].data)).toEqual(['live-a']);
  });

  it('credits the tile source, which the licence requires on every map surface', () => {
    const { getByTestId } = render(
      <PreviewMapView
        result={null}
        currentSections={[section('live-a')]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(getByTestId('map-attribution-text').props.children).toBe(
      '\u00a9 OpenFreeMap \u00a9 OpenMapTiles \u00a9 OpenStreetMap'
    );
  });

  it('names the regional satellite sources under the selected area', () => {
    mockGlobalMapStyle = 'satellite';

    const { getByTestId } = render(
      <PreviewMapView
        result={null}
        currentSections={[section('live-a')]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    const text = getByTestId('map-attribution-text').props.children as string;
    expect(text).toContain('swisstopo');
    expect(text).toContain('EOX');
  });

  it('still credits satellite imagery when no area is selected', () => {
    mockGlobalMapStyle = 'satellite';

    const { getByTestId } = render(
      <PreviewMapView
        result={null}
        currentSections={[]}
        centre={null}
        selectedId={null}
        showCurrent
        showProposed
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(getByTestId('map-attribution-text').props.children).toBe('Sentinel-2 cloudless by EOX');
  });
});
