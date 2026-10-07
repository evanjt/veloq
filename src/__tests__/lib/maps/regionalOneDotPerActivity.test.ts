/**
 * Scenario: the global map used to draw one circle per activity from two
 * sources: `unclustered-point` at the bounds centre and a second layer at the
 * first GPS coordinate, ramped to nothing on either side of the handover.
 * Zeroing a circle's radius left its stroke, which MapLibre paints as a filled
 * disc of the stroke width, so the hidden dot still drew as a speck.
 *
 * Expected behaviour: one source and one layer draw the dot, at every zoom
 * and never none. The cluster source's points sit at the activity's start, so
 * the dot is the one a tap needs.
 */

import {
  buildRegionalLayers,
  REGIONAL_INTERACTIVE_LAYERS,
  UNCLUSTERED_POINT_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';

function layers(selectedActivityId: string | null = null) {
  return buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: false,
    showRoutes: false,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId,
    selectedSectionId: null,
    routeColor: '#000000',
  });
}

/** Which feature a paint value is read for: the selected activity or any other. */
interface Reading {
  selectedActivityId: string | null;
  isSelected: boolean;
}

const READINGS: Reading[] = [
  { selectedActivityId: null, isSelected: false },
  { selectedActivityId: 'a1', isSelected: true },
  { selectedActivityId: 'a1', isSelected: false },
];

function paintOf(id: string, selectedActivityId: string | null = null): Record<string, unknown> {
  const layer = layers(selectedActivityId).find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return (layer as { paint: Record<string, unknown> }).paint;
}

/**
 * A paint value read at one zoom for one feature: a number, a selection
 * `case`, or a linear `interpolate` on zoom whose stops may be either.
 */
function valueAt(expr: unknown, zoom: number, isSelected = false): number {
  if (typeof expr === 'number') return expr;
  const parts = expr as unknown[];
  if (parts[0] === 'case') return valueAt(isSelected ? parts[2] : parts[3], zoom, isSelected);
  if (parts[0] !== 'interpolate') throw new Error(`cannot read ${JSON.stringify(expr)}`);
  const stops: [number, number][] = [];
  for (let i = 3; i < parts.length; i += 2) {
    stops.push([parts[i] as number, valueAt(parts[i + 1], zoom, isSelected)]);
  }
  if (zoom <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (zoom >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, r0] = stops[i - 1];
    const [z1, r1] = stops[i];
    if (zoom <= z1) return r0 + ((zoom - z0) / (z1 - z0)) * (r1 - r0);
  }
  return last[1];
}

function radiusAt(id: string, zoom: number, reading: Reading = READINGS[0]): number {
  const paint = paintOf(id, reading.selectedActivityId);
  return valueAt(paint['circle-radius'], zoom, reading.isSelected);
}

/** What the renderer paints: the circle and its stroke, zero only when both are. */
function drawnSizeAt(id: string, zoom: number, reading: Reading): number {
  const paint = paintOf(id, reading.selectedActivityId);
  return (
    valueAt(paint['circle-radius'], zoom, reading.isSelected) +
    valueAt(paint['circle-stroke-width'] ?? 0, zoom, reading.isSelected)
  );
}

describe('the global map draws one dot per activity', () => {
  const zooms = Array.from({ length: 45 }, (_, i) => i * 0.5);
  const cases = zooms.flatMap((zoom) => READINGS.map((reading) => [zoom, reading] as const));

  it('has no second layer for the activity dot', () => {
    const ids = layers().map((l) => l.id);

    expect(ids).not.toContain('start-point-outer');
    expect(layers().filter((l) => l.source === 'activity-start-points')).toEqual([]);
  });

  it.each(cases)(
    'draws a filled dot at zoom %s, a lone unclustered ride included (%o)',
    (zoom, reading) => {
      expect(radiusAt(UNCLUSTERED_POINT_LAYER_ID, zoom, reading)).toBeGreaterThan(0);
      expect(drawnSizeAt(UNCLUSTERED_POINT_LAYER_ID, zoom, reading)).toBeGreaterThan(0);
    }
  );

  it('keeps the dot at and above the old handover zoom', () => {
    expect(radiusAt(UNCLUSTERED_POINT_LAYER_ID, TRACE_ZOOM_THRESHOLD)).toBeGreaterThan(0);
    expect(radiusAt(UNCLUSTERED_POINT_LAYER_ID, TRACE_ZOOM_THRESHOLD + 4)).toBeGreaterThan(0);
  });
});

describe('the dot the athlete sees is the dot a tap hits', () => {
  it('answers a tap from the unclustered layer, the only activity dot', () => {
    expect(REGIONAL_INTERACTIVE_LAYERS).toContain(UNCLUSTERED_POINT_LAYER_ID);
    expect(REGIONAL_INTERACTIVE_LAYERS).not.toContain('start-point-outer');
  });
});
