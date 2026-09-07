/**
 * Scenario: the athlete pans and zooms the preview map, then runs a preview
 * against the area already on screen.
 *
 * Expected behaviour: the camera stays where they put it. Comparing two
 * catalogues in one frame is the point of the diff, and the refit was keyed on
 * the geometry, so a run threw the viewport away twice: once when the sections
 * emptied and again when the result landed. Choosing a different area is the
 * one event that still moves the camera.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import type { PreviewResult, PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

const mockFitBounds = jest.fn();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 8.7, latitude: 47.5 },
      { longitude: 8.71, latitude: 47.51 },
    ],
  })
);

jest.mock('@/features/maps/components', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  const { View } = require('react-native');
  return {
    ...require('@/features/maps/components/AttributionOverlay'),
    MapSurface: forwardRef(function MapSurface(_props: unknown, ref: unknown) {
      useImperativeHandle(ref, () => ({ fitBounds: mockFitBounds }), []);
      return <View testID="map-surface" />;
    }),
  };
});

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => 'light' }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

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

function resultOf(sections: PreviewSection[]): PreviewResult {
  return {
    pool: { activities: 10, empty: 0, unreadable: 0 },
    elapsedMs: 100,
    config: {
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 20000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    },
    counts: { current: 1, proposed: 1, unchanged: 1, changed: 0, new: 0, gone: 0 },
    sections,
  };
}

const ZURICH = { lat: 47.5, lng: 8.7 };
const SYDNEY = { lat: -33.86, lng: 151.2 };

function view(props: {
  centre: typeof ZURICH;
  currentSections: PreviewSection[];
  result: PreviewResult | null;
}) {
  return (
    <PreviewMapView
      centre={props.centre}
      currentSections={props.currentSections}
      result={props.result}
      showCurrent
      showProposed
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      selectedId={null}
      onSelect={jest.fn()}
    />
  );
}

describe('the preview camera', () => {
  beforeEach(() => mockFitBounds.mockClear());

  it('frames the area once when the screen opens', () => {
    render(view({ centre: ZURICH, currentSections: [section('a')], result: null }));
    expect(mockFitBounds).toHaveBeenCalledTimes(1);
  });

  it('holds the viewport when a run finishes on the area already framed', () => {
    const tree = render(view({ centre: ZURICH, currentSections: [section('a')], result: null }));
    mockFitBounds.mockClear();

    // A run empties the geometry, then lands a new catalogue.
    tree.rerender(view({ centre: ZURICH, currentSections: [], result: null }));
    tree.rerender(view({ centre: ZURICH, currentSections: [], result: resultOf([section('b')]) }));

    expect(mockFitBounds).not.toHaveBeenCalled();
  });

  it('holds the viewport when a run comes back with nothing', () => {
    const tree = render(view({ centre: ZURICH, currentSections: [section('a')], result: null }));
    mockFitBounds.mockClear();

    tree.rerender(view({ centre: ZURICH, currentSections: [], result: resultOf([]) }));

    expect(mockFitBounds).not.toHaveBeenCalled();
  });

  it('refits when the athlete picks a different area', () => {
    const tree = render(view({ centre: ZURICH, currentSections: [section('a')], result: null }));
    mockFitBounds.mockClear();

    tree.rerender(view({ centre: SYDNEY, currentSections: [section('c')], result: null }));

    expect(mockFitBounds).toHaveBeenCalledTimes(1);
  });
});
