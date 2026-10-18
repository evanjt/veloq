/**
 * Expected behaviour: a detail map draws its subject in the base's route colour
 * whatever the sport, on the base's casing. Context (the matched route, other
 * attempts, the parts outside a highlighted section) is the base's muted colour
 * rather than a fainter subject. Selection marks (the highlighted attempt, the
 * scrub cursor, the finish square) are the base's ink. The start is the base's
 * start colour, a record is the base's record colour, and a section badge is a
 * route disc carrying its number in badge ink.
 */

import { mapPalette, type MapPalette } from '@/theme';
import {
  buildActivityLayers,
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
} from '@/features/maps/components/activityMapLayerSpecs';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { composeBaseMapLayers } from '@/features/maps/lib/baseMapLayers';
import { buildEndpointLayers } from '@/features/maps/lib/endpointLayers';
import { buildUserLocationLayers } from '@/features/maps/lib/userLocationLayer';
import {
  sectionCreation3DLayers,
  sectionCreationMarkerPaint,
} from '@/features/maps/lib/sectionCreationPaint';
import { buildSectionLayers } from '@/features/routes/components/sectionMapLayerSpecs';
import { buildRouteLayers } from '@/features/routes/components/routeMapLayerSpecs';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const BASES = ['light', 'dark', 'satellite'] as const;
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function paint(layers: MapLayerSpec[], id: string): Record<string, unknown> {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return (layer.paint ?? {}) as Record<string, unknown>;
}

function activity(palette: MapPalette, highlightedSectionId: string | null) {
  return buildActivityLayers({
    palette,
    overlayHasData: true,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: true,
    highlightedSectionId,
    hasHighlightPoint: true,
    creationMode: true,
    hasUserLocation: true,
  });
}

function section(palette: MapPalette, sectionContext = false) {
  return buildSectionLayers({
    palette,
    shadowGeoJSON: empty,
    extensionGeoJSON: empty,
    sectionGeoJSON: empty,
    trimmedGeoJSON: empty,
    allTracesFeatureCollection: empty,
    highlightedLapGeoJSON: empty,
    highlightedTraceGeoJSON: empty,
    highlightedTraceFilter: ['==', 'id', 'a'],
    hasAllTraces: true,
    endpoints: empty,
    sectionContext,
    trimRange: { start: 0, end: 1 },
    hasExtension: true,
    showExtensionAndSection: true,
    trimCasingWidth: 5,
    trimLineWidth: 4,
    traceCasingWidth: 5,
    traceLineWidth: 4,
    deltaBands: null,
    deltaGapsGeoJSON: empty,
  } as unknown as Parameters<typeof buildSectionLayers>[0]);
}

describe.each(BASES)('on the %s base', (base) => {
  const palette = mapPalette(base);

  it('marks the start in the start colour and the finish in ink, on the casing', () => {
    const layers = buildEndpointLayers(palette);
    expect(paint(layers, 'endpoint-border')['circle-color']).toBe(palette.casing);
    const fill = paint(layers, 'endpoint-fill')['circle-color'] as unknown[];
    expect(fill[2]).toBe(palette.start);
    expect(fill[3]).toBe(palette.ink);
    expect(paint(layers, 'endpoint-icon')['icon-color']).toBe(palette.casing);
  });

  it('draws the scrub cursor as an ink dot ringed in the casing', () => {
    const layers = activity(palette, null);
    expect(paint(layers, 'highlight-fill')['circle-color']).toBe(palette.ink);
    expect(paint(layers, 'highlight-border')['circle-color']).toBe(palette.casing);
  });

  it('draws the activity line in the route colour on the casing', () => {
    const layers = activity(palette, null);
    expect(paint(layers, 'route-casing')['line-color']).toBe(palette.casing);
    expect(paint(layers, 'route-line')['line-color']).toBe(palette.route);
    expect(paint(layers, 'route-line')['line-opacity']).toBe(1);
  });

  it('mutes the activity line by colour, not opacity, while a section is highlighted', () => {
    const layers = activity(palette, 's1');
    expect(paint(layers, 'route-line')['line-color']).toBe(palette.muted);
    expect(paint(layers, 'route-line')['line-opacity']).toBe(1);
    const portion = paint(layers, 'portion-line')['line-color'] as unknown[];
    expect(portion[2]).toBe(palette.ink);
    expect(portion[3]).toBe(palette.muted);
  });

  it('draws section portions as the route line, a record in the record colour', () => {
    const colour = paint(activity(palette, null), 'portion-line')['line-color'] as unknown[];
    expect(colour).toEqual(['case', ['==', ['get', 'isPR'], true], palette.record, palette.route]);
    const fullscreen = paint(
      buildFullscreenSectionLayers(true, palette),
      'fullscreen-portion-line'
    );
    expect(fullscreen['line-color']).toEqual(colour);
  });

  it('draws section badges as route discs with badge ink, and the trophy in record', () => {
    const layers = activity(palette, null);
    expect(paint(layers, 'section-marker-circle')['circle-color']).toBe(palette.route);
    expect(paint(layers, 'section-marker-circle')['circle-stroke-color']).toBe(palette.casing);
    expect(paint(layers, 'section-marker-label')['text-color']).toBe(palette.badgeInk);
    expect(paint(layers, 'section-marker-pr-icon')['icon-color']).toBe(palette.record);
  });

  it('draws the matched route as muted context with no casing', () => {
    for (const layers of [
      activity(palette, null),
      buildFullscreenMatchedRouteLayers(true, palette),
    ]) {
      const line = layers.find((l) => l.id.endsWith('overlay-line'));
      expect(line?.paint?.['line-color']).toBe(palette.muted);
      expect(line?.paint?.['line-width']).toBe(8);
      expect(layers.some((l) => l.id.endsWith('overlay-casing'))).toBe(false);
    }
  });

  it('draws section creation in ink with start and finish markers', () => {
    const marker = sectionCreationMarkerPaint('position', palette)['circle-color'];
    expect(marker[2]).toBe(palette.start);
    expect(marker[3]).toBe(palette.ink);
    const line = sectionCreation3DLayers(true, palette)[0].paint as Record<string, unknown>;
    expect(line['line-color']).toBe(palette.ink);
  });

  it('draws the section line in route, context in muted and attempts in ink', () => {
    const layers = section(palette);
    expect(paint(layers, 'section-line')['line-color']).toBe(palette.route);
    expect(paint(layers, 'section-casing')['line-color']).toBe(palette.casing);
    expect(paint(layers, 'trimmed-line')['line-color']).toBe(palette.route);
    expect(paint(layers, 'extension-line')['line-color']).toBe(palette.muted);
    expect(paint(layers, 'shadow-line')['line-color']).toBe(palette.muted);
    for (const id of ['all-traces', 'highlighted-lap', 'highlighted-trace']) {
      expect(paint(layers, `${id}-line`)['line-color']).toBe(palette.ink);
      expect(paint(layers, `${id}-casing`)['line-color']).toBe(palette.casing);
    }
  });

  it('draws the route line in route, other attempts in muted and the pick in ink', () => {
    const build = (routeContext: boolean) =>
      buildRouteLayers({ palette, routeContext, fadedFilter: undefined, includeRoute: true });
    const layers = build(false);
    expect(paint(layers, 'route-line')['line-color']).toBe(palette.route);
    expect(paint(layers, 'faded-traces-line')['line-color']).toBe(palette.muted);
    expect(paint(layers, 'faded-traces-line')['line-opacity']).toBeUndefined();
    expect(paint(layers, 'highlighted-line')['line-color']).toBe(palette.ink);
    expect(paint(layers, 'highlighted-casing')['line-color']).toBe(palette.casing);
    const picked = build(true);
    expect(paint(picked, 'route-line')['line-color']).toBe(palette.muted);
    expect(paint(picked, 'route-line')['line-opacity']).toBeUndefined();
  });

  it('mutes the section line by colour while an attempt is shown', () => {
    const layers = section(palette, true);
    expect(paint(layers, 'section-line')['line-color']).toBe(palette.muted);
    expect(paint(layers, 'section-line')['line-opacity']).toBeUndefined();
    expect(paint(layers, 'section-casing')['line-opacity']).toBe(0);
  });

  it('draws the fullscreen subject in route, or muted when it is context', () => {
    const input = { palette, underRouteLayers: [], overlayLayers: [], userLocationLayers: [] };
    expect(paint(composeBaseMapLayers(input), 'route-line')['line-color']).toBe(palette.route);
    expect(
      paint(composeBaseMapLayers({ ...input, routeContext: true }), 'route-line')['line-color']
    ).toBe(palette.muted);
  });

  it('draws the fullscreen subject in the ramp the inline map draws, when it is banded', () => {
    const ramp = ['step', ['line-progress'], palette.div['warm-1'], 0.5, palette.div.mid];
    const input = { palette, underRouteLayers: [], overlayLayers: [], userLocationLayers: [] };
    const banded = paint(composeBaseMapLayers({ ...input, routeGradient: ramp }), 'route-line');
    expect(banded['line-gradient']).toEqual(ramp);
    expect(banded['line-color']).toBeUndefined();
  });

  it('draws the location dot in the location colour', () => {
    const layers = buildUserLocationLayers(true, palette);
    expect(paint(layers, 'user-location-inner')['circle-color']).toBe(palette.location);
    expect(paint(layers, 'user-location-outer')['circle-color']).toBe(palette.location);
  });

  it('draws a cluster as a route disc in badge ink, and edges the sport-coloured pick', () => {
    const layers = buildRegionalLayers({
      palette,
      showActivities: true,
      showSections: true,
      showRoutes: true,
      showHeatmap: false,
      heatmapEnabled: false,
      hasSpider: true,
      hasUserLocation: true,
      hasRouteData: true,
      selectedActivityId: 'a',
      selectedSectionId: null,
      selectedRouteId: null,
      routeColor: '#abcdef',
    });
    expect(paint(layers, 'cluster-circles')['circle-color']).toBe(palette.route);
    expect(paint(layers, 'cluster-count')['text-color']).toBe(palette.badgeInk);
    expect(paint(layers, 'selected-route-outline')['line-color']).toBe(palette.edge);
  });
});
