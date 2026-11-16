/**
 * Scenario: route lines share the regional map with sections.
 *
 * Expected behaviour: the routes source is declared whether or not the layer is shown,
 * the line layer is toggled through `visible`, and it draws under the section lines.
 */
import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { mapPalette } from '@/theme';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function layers(showRoutes: boolean) {
  return buildRegionalLayers({
    palette: mapPalette('light'),
    showActivities: true,
    showSections: true,
    showRoutes,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#fff',
  });
}

describe('regional routes layer', () => {
  it('keeps the routes source declared with an empty collection', () => {
    const sources = buildRegionalSources({
      markersGeoJSON: empty,
      sectionsGeoJSON: empty,
      routesGeoJSON: empty,
      userLocationGeoJSON: empty,
      routeGeoJSON: empty,
      spiderPointsGeoJSON: empty,
      spiderLinesGeoJSON: empty,
      heatmapEnabled: false,
      heatmapBase: 'light',
    });
    expect(sources.routes).toEqual({ kind: 'geojson', data: empty });
  });

  it('toggles the line layer by visibility and draws it under the sections', () => {
    const on = layers(true);
    const off = layers(false);
    expect(on.find((l) => l.id === 'routes-line')?.visible).toBe(true);
    expect(off.find((l) => l.id === 'routes-line')?.visible).toBe(false);
    const ids = on.map((l) => l.id);
    expect(ids.indexOf('routes-line')).toBeLessThan(ids.indexOf('sections-outline'));
  });
});

describe('regional section line colour', () => {
  it('reads the slot each section feature carries through the palette match', () => {
    const line = layers(true).find((l) => l.id === 'sections-line');
    const colour = (line?.paint as Record<string, unknown>)['line-color'] as unknown[];
    const slots = mapPalette('light').layer.sections;

    expect(colour.slice(0, 2)).toEqual(['match', ['get', 'colorIndex']]);
    slots.forEach((hue) => expect(colour.slice(2, 2 + 2 * slots.length)).toContain(hue));
    expect(colour[colour.length - 1]).toBe(slots[0]);
  });
});
