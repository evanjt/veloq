/**
 * Scenario: an area is selected on the detection preview map.
 * Expected behaviour: a dashed white box shows which ground the area covers,
 * drawn from the same bounds the camera clamps to and the label is derived
 * from, so the three never disagree about what "this area" means. The source
 * stays mounted with an empty collection when there is no area, per the
 * standing rule about conditional sources on the native path.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import { previewAreaBounds } from '@/features/routes/lib/previewMapCamera';
import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { mapLayerColors } from '@/theme';

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

const CENTRE = { binKey: '1055:193', lat: 47.5, lng: 8.7 };

function renderMap(centre: typeof CENTRE | null) {
  capturedSources.length = 0;
  render(
    <PreviewMapView
      result={null}
      currentSections={[]}
      centre={centre}
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

describe('the preview area envelope', () => {
  it('draws the selected area as a closed ring', () => {
    const source = renderMap(CENTRE);
    const features = source['preview-area'].data.features;

    expect(features).toHaveLength(1);
    const ring = (features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('draws the box the camera clamps to, not one around the reported point', () => {
    const source = renderMap(CENTRE);
    const area = previewAreaBounds(CENTRE);
    if (!area) throw new Error('the selected area has no bounds');
    const ring = (source['preview-area'].data.features[0].geometry as GeoJSON.Polygon)
      .coordinates[0];

    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(Math.min(...lngs)).toBeCloseTo(area.sw[0], 10);
    expect(Math.min(...lats)).toBeCloseTo(area.sw[1], 10);
    expect(Math.max(...lngs)).toBeCloseTo(area.ne[0], 10);
    expect(Math.max(...lats)).toBeCloseTo(area.ne[1], 10);
    // The reported point is the mean of the bin's members and sits off centre.
    expect(area.sw[1]).not.toBeCloseTo(CENTRE.lat, 3);
  });

  it('keeps the source mounted and empty when no area is selected', () => {
    const source = renderMap(null);

    expect(source['preview-area']).toBeDefined();
    expect(source['preview-area'].data.features).toEqual([]);
  });

  it('draws it as a dashed white line under the section layers', () => {
    const layers = buildPreviewLayers();
    const envelope = layers.find((l) => l.id === 'preview-area-line');

    expect(envelope?.source).toBe('preview-area');
    expect(envelope?.paint?.['line-color']).toBe(mapLayerColors.casing);
    expect(envelope?.paint?.['line-dasharray']).toBeDefined();
    expect(layers.findIndex((l) => l.id === 'preview-area-line')).toBeLessThan(
      layers.findIndex((l) => l.id === 'current-casing')
    );
  });

  it('is not tappable, so it never swallows a tap meant for a section', () => {
    const {
      PREVIEW_INTERACTIVE_LAYERS,
    } = require('@/features/routes/components/preview/previewMapLayerSpecs');

    expect(PREVIEW_INTERACTIVE_LAYERS).not.toContain('preview-area-line');
  });
});
