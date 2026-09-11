/**
 * Scenario: on the activity Route tab the matched route is drawn under the
 * activity track. At 5px and half opacity, in the same cyan the selected trace
 * uses, it disappeared into satellite terrain and into the green track above it.
 *
 * Expected behaviour: the matched route has its own casing, is wider than the
 * activity line drawn over it, and uses the colour reserved for a saved route.
 */

import {
  buildActivityLayers,
  buildActivitySources,
  buildFullscreenSectionLayers,
  buildFullscreenSectionSources,
} from '@/features/maps/components/activityMapLayerSpecs';
import { mapLayerColors } from '@/theme';

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function layers(overrides: Record<string, unknown> = {}) {
  return buildActivityLayers({
    routeGeoJSON: EMPTY_COLLECTION,
    overlayGeoJSON: EMPTY_COLLECTION,
    overlayHasData: true,
    consolidatedPortionsGeoJSON: EMPTY_COLLECTION,
    sectionBoundariesGeoJSON: EMPTY_COLLECTION,
    sectionMarkersGeoJSON: EMPTY_COLLECTION,
    highlightGeoJSON: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    endpointsGeoJSON: EMPTY_COLLECTION,
    sectionCreationLine: EMPTY_COLLECTION,
    sectionCreationMarkers: EMPTY_COLLECTION,
    activityColor: '#00FF00',
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: false,
    highlightedSectionId: null,
    hasHighlightPoint: false,
    creationMode: false,
    ...overrides,
  });
}

function layer(id: string, overrides: Record<string, unknown> = {}) {
  const found = layers(overrides).find((l) => l.id === id);
  if (!found) throw new Error(`no layer ${id}`);
  return found as { id: string; source: string; paint: Record<string, unknown> };
}

describe('matched route overlay', () => {
  it('draws a casing under the matched route, so it reads on any basemap', () => {
    expect(layer('overlay-casing').paint['line-color']).toBe(mapLayerColors.casing);
  });

  it('colours the matched route as a saved route, not as the selected trace', () => {
    expect(layer('overlay-line').paint['line-color']).toBe(mapLayerColors.routeOverlay);
    expect(layer('overlay-line').paint['line-color']).not.toBe(mapLayerColors.highlight);
  });

  it('draws the matched route wider than the activity line above it', () => {
    const overlay = layer('overlay-line').paint['line-width'] as number;
    const routeCasing = layer('route-casing').paint['line-width'] as number;
    expect(overlay).toBeGreaterThan(routeCasing);
    expect(layer('overlay-casing').paint['line-width'] as number).toBeGreaterThan(overlay);
  });

  it('keeps the matched route opaque enough to follow', () => {
    expect(layer('overlay-line').paint['line-opacity'] as number).toBeGreaterThanOrEqual(0.9);
  });

  it('puts both overlay layers behind the activity line', () => {
    const ids = layers().map((l) => l.id);
    expect(ids.indexOf('overlay-casing')).toBeLessThan(ids.indexOf('overlay-line'));
    expect(ids.indexOf('overlay-line')).toBeLessThan(ids.indexOf('route-casing'));
  });

  it('reads both overlay layers from the one overlay source', () => {
    expect(layer('overlay-casing').source).toBe('overlay');
    expect(layer('overlay-line').source).toBe('overlay');
    expect(Object.keys(buildActivitySources({} as never))).toContain('overlay');
  });
});

describe('matched route overlay in fullscreen', () => {
  it('carries the matched route into fullscreen, where it was missing entirely', () => {
    const ids = buildFullscreenSectionLayers(false, true).map((l) => l.id);
    expect(ids).toContain('fullscreen-overlay-casing');
    expect(ids).toContain('fullscreen-overlay-line');
  });

  it('draws the matched route behind the section portions', () => {
    const ids = buildFullscreenSectionLayers(true, true).map((l) => l.id);
    expect(ids.indexOf('fullscreen-overlay-casing')).toBeLessThan(
      ids.indexOf('fullscreen-overlay-line')
    );
    expect(ids.indexOf('fullscreen-overlay-line')).toBeLessThan(
      ids.indexOf('fullscreen-portion-casing')
    );
  });

  it('hides the matched route when there is none to draw', () => {
    const hidden = buildFullscreenSectionLayers(false, false).find(
      (l) => l.id === 'fullscreen-overlay-line'
    ) as { paint: Record<string, unknown> };
    expect(hidden.paint['line-opacity']).toBe(0);
  });

  it('gives fullscreen the same colour and weights as the embedded map', () => {
    const full = buildFullscreenSectionLayers(false, true).find(
      (l) => l.id === 'fullscreen-overlay-line'
    ) as { paint: Record<string, unknown> };
    expect(full.paint['line-color']).toBe(mapLayerColors.routeOverlay);
    expect(full.paint['line-width']).toBe(layer('overlay-line').paint['line-width']);
  });

  it('takes the matched route from its own source', () => {
    expect(
      Object.keys(buildFullscreenSectionSources(EMPTY_COLLECTION, EMPTY_COLLECTION))
    ).toContain('overlay');
  });
});
