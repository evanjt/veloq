/**
 * Scenario: the Map tab draws section and route lines over the ground, the
 * heat and the imagery.
 *
 * Expected behaviour: every section and route line sits on the base's edge,
 * wider than the line at every zoom, whether or not anything is selected.
 */
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { OVERLAY_EDGE_MARGIN } from '@/features/maps/lib/mapLineWidths';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { mapPalette, type MapPalette } from '@/theme';

const BASES = ['light', 'dark', 'satellite'] as const;

function paint(layers: { id: string; paint?: unknown }[], id: string): Record<string, unknown> {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return (layer.paint ?? {}) as Record<string, unknown>;
}

/** The zooms a width expression names a stop at, or none for a constant. */
function stopZooms(width: unknown): number[] {
  if (typeof width === 'number') return [];
  const [op, , input, ...stops] = width as unknown[];
  expect([op, input]).toEqual(['interpolate', ['zoom']]);
  return stops.filter((_, i) => i % 2 === 0) as number[];
}

/** A constant width, or a linear zoom ramp read at `zoom` as MapLibre reads it. */
function widthAt(width: unknown, zoom: number): number {
  if (typeof width === 'number') return width;
  const [, , , ...flat] = width as unknown[];
  const stops: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) stops.push([flat[i] as number, flat[i + 1] as number]);
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, w0] = stops[i - 1];
    const [z1, w1] = stops[i];
    if (zoom <= z1) return w0 + ((w1 - w0) * (zoom - z0)) / (z1 - z0);
  }
  return stops[stops.length - 1][1];
}

function regional(palette: MapPalette, selectedSectionId: string | null = null) {
  return buildRegionalLayers({
    palette,
    showActivities: true,
    showSections: true,
    showRoutes: true,
    showHeatmap: true,
    heatmapEnabled: true,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId,
    selectedRouteId: null,
    routeColor: '#abcdef',
  });
}

const PAIRS = [
  ['sections-outline', 'sections-line'],
  ['routes-outline', 'routes-line'],
] as const;

describe('the Map tab overlay lines on the flat map', () => {
  it.each(BASES)('edge every section and route line on the %s base', (base) => {
    const palette = mapPalette(base);
    const layers: MapLayerSpec[] = regional(palette);

    for (const [outlineId, lineId] of PAIRS) {
      const outline = paint(layers, outlineId);
      const line = paint(layers, lineId);
      expect(outline['line-color']).toBe(palette.edge);
      expect(outline['line-opacity']).toBe(1);
      const zooms = [...stopZooms(line['line-width']), ...stopZooms(outline['line-width'])];
      expect(zooms.length).toBeGreaterThan(0);
      for (const zoom of zooms) {
        expect(widthAt(outline['line-width'], zoom)).toBeCloseTo(
          widthAt(line['line-width'], zoom) + OVERLAY_EDGE_MARGIN
        );
      }
    }
  });

  it('draws a section line about 2 px wide at zoom 6 and 4 px at zoom 18', () => {
    const width = paint(regional(mapPalette('satellite')), 'sections-line')['line-width'];

    expect(widthAt(width, 6)).toBeGreaterThanOrEqual(2);
    expect(widthAt(width, 18)).toBeGreaterThanOrEqual(4);
  });

  it('keeps the edge under the sections a selection leaves, and raises the pick on the casing', () => {
    const palette = mapPalette('light');
    const outline = paint(regional(palette, 's1'), 'sections-outline');

    expect(outline['line-color']).toEqual([
      'case',
      ['==', ['get', 'id'], 's1'],
      palette.casing,
      palette.edge,
    ]);
    const width = outline['line-width'] as unknown[];
    expect(width[0]).toBe('case');
    expect(width[3]).toBeGreaterThan(0);
  });

  it('hides the edges with the layers they sit under', () => {
    const layers = buildRegionalLayers({
      palette: mapPalette('light'),
      showActivities: true,
      showSections: false,
      showRoutes: false,
      showHeatmap: false,
      heatmapEnabled: false,
      hasSpider: false,
      hasUserLocation: false,
      hasRouteData: false,
      selectedActivityId: null,
      selectedSectionId: null,
      routeColor: '#abcdef',
    });

    expect(paint(layers, 'sections-outline')['line-opacity']).toBe(0);
    expect(paint(layers, 'routes-outline')['line-opacity']).toBe(0);
  });
});
