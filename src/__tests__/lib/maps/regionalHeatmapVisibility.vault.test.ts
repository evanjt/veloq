/**
 * Scenario: the regional map adds its heatmap layer whenever the heatmap is
 * available and hides it, when the athlete has it switched off, by setting
 * `raster-opacity` to zero. A raster layer at zero opacity keeps
 * `visibility: visible`, so MapLibre requests every tile in the viewport and
 * paints them invisibly.
 *
 * Expected behaviour: the layer is hidden through `visible`, the way every
 * other layer in this builder is, and `raster-opacity` stays at one, since the
 * tiles carry each base's opaque heat steps. The source stays declared either
 * way: keeping it mounted and flipping visibility is the house rule for
 * MapLibre sources here.
 */

import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { mapPalette } from '@/theme';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function heatmapLayer(overrides: Partial<Parameters<typeof buildRegionalLayers>[0]> = {}) {
  return buildRegionalLayers({
    palette: mapPalette('light'),
    showActivities: true,
    showSections: true,
    showRoutes: false,
    showHeatmap: false,
    heatmapEnabled: true,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#ff0000',
    ...overrides,
  }).find((layer) => layer.id === 'heatmap-layer');
}

describe('the regional map heatmap layer', () => {
  it('is hidden through visible, not by a zero opacity that still fetches', () => {
    const layer = heatmapLayer({ showHeatmap: false });

    expect(layer?.visible).toBe(false);
    expect(layer?.paint?.['raster-opacity']).not.toBe(0);
  });

  it.each(['light', 'dark', 'satellite'] as const)(
    'is shown at full opacity over the %s base when the heatmap is on',
    (base) => {
      const layer = heatmapLayer({ showHeatmap: true, palette: mapPalette(base) });

      expect(layer?.visible).toBe(true);
      expect(layer?.paint?.['raster-opacity']).toBe(1);
    }
  );

  it('is hidden the way every other layer in this builder is', () => {
    const hidden = buildRegionalLayers({
      palette: mapPalette('light'),
      showActivities: false,
      showSections: true,
      showRoutes: false,
      showHeatmap: false,
      heatmapEnabled: true,
      hasSpider: false,
      hasUserLocation: false,
      hasRouteData: false,
      selectedActivityId: null,
      selectedSectionId: null,
      routeColor: '#ff0000',
    }).filter((layer) => layer.visible === false);

    expect(hidden.map((layer) => layer.id)).toContain('heatmap-layer');
    expect(hidden.length).toBeGreaterThan(1);
  });

  it('keeps the same opacity whether it is shown or not, so only visibility toggles', () => {
    expect(heatmapLayer({ showHeatmap: false })?.paint?.['raster-opacity']).toBe(
      heatmapLayer({ showHeatmap: true })?.paint?.['raster-opacity']
    );
  });

  it('is not added at all where the heatmap is unavailable', () => {
    expect(heatmapLayer({ heatmapEnabled: false })).toBeUndefined();
  });

  it('leaves the source declared, so the layer has something to read', () => {
    const sources = buildRegionalSources({
      markersGeoJSON: empty,
      sectionsGeoJSON: empty,
      routesGeoJSON: empty,
      userLocationGeoJSON: empty,
      routeGeoJSON: empty,
      spiderPointsGeoJSON: empty,
      spiderLinesGeoJSON: empty,
      heatmapEnabled: true,
      heatmapBase: 'light',
    });

    expect(sources['heatmap-tiles']).toBeDefined();
  });
});
