/**
 * Scenario: the regional map adds its heatmap layer whenever the heatmap is
 * available and hides it, when the athlete has it switched off, by setting
 * `raster-opacity` to zero. A raster layer at zero opacity keeps
 * `visibility: visible`, so MapLibre requests every tile in the viewport and
 * paints them invisibly.
 *
 * Expected behaviour: the layer is hidden through `visible`, the way every
 * other layer in this builder is, and `raster-opacity` carries only the light
 * and dark tuning. The source stays declared either way: keeping it mounted and
 * flipping visibility is the house rule for MapLibre sources here.
 */

import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function heatmapLayer(overrides: Partial<Parameters<typeof buildRegionalLayers>[0]> = {}) {
  return buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: true,
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

  it('is shown, and carries the light tuning, when the heatmap is on', () => {
    const layer = heatmapLayer({ showHeatmap: true, mapStyle: 'light' });

    expect(layer?.visible).toBe(true);
    expect(layer?.paint?.['raster-opacity']).toBe(0.92);
  });

  it('carries the dark tuning under a dark style', () => {
    const layer = heatmapLayer({ showHeatmap: true, mapStyle: 'dark' });

    expect(layer?.visible).toBe(true);
    expect(layer?.paint?.['raster-opacity']).toBe(0.72);
  });

  it('is hidden the way every other layer in this builder is', () => {
    const hidden = buildRegionalLayers({
      isDark: false,
      mapStyle: 'light',
      showActivities: false,
      showSections: true,
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
      startPointsGeoJSON: empty,
      sectionsGeoJSON: empty,
      userLocationGeoJSON: empty,
      routeGeoJSON: empty,
      spiderPointsGeoJSON: empty,
      spiderLinesGeoJSON: empty,
      heatmapEnabled: true,
    });

    expect(sources['heatmap-tiles']).toBeDefined();
  });
});
