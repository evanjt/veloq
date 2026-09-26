/**
 * Scenario: zoom the global map past the cluster handover. Two layers draw one
 * circle per activity from two sources: `unclustered-point` at the bounds
 * centre, `start-point-outer` at the first GPS coordinate. A ride whose centre
 * sits a few hundred metres from where it started drew both, at full opacity.
 *
 * Expected behaviour: one dot per activity at every zoom. The centre dot ramps
 * to nothing where the start point takes over, which is the dot a tap needs.
 */

import {
  buildRegionalLayers,
  UNCLUSTERED_POINT_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';

function layers() {
  return buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: false,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#000000',
  });
}

function paintOf(id: string): Record<string, unknown> {
  const layer = layers().find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return (layer as { paint: Record<string, unknown> }).paint;
}

/**
 * A MapLibre `interpolate` on zoom, read at one zoom. Stops are pairs after
 * the first three elements, and the ramps here are linear between two of them.
 */
function radiusAt(expr: unknown, zoom: number): number {
  if (typeof expr === 'number') return expr;
  const parts = expr as unknown[];
  const stops: [number, number][] = [];
  for (let i = 3; i < parts.length; i += 2) {
    const value = parts[i + 1];
    stops.push([parts[i] as number, typeof value === 'number' ? value : 8]);
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

describe('the global map draws one dot per activity', () => {
  const zooms = Array.from({ length: 45 }, (_, i) => i * 0.5);

  it.each(zooms)('draws only one of the two dots at zoom %s', (zoom) => {
    const centre = radiusAt(paintOf(UNCLUSTERED_POINT_LAYER_ID)['circle-radius'], zoom);
    const start = radiusAt(paintOf('start-point-outer')['circle-radius'], zoom);

    expect(Math.min(centre, start)).toBe(0);
  });

  it('leaves a dot at every zoom from where the clusters break up', () => {
    for (const zoom of zooms.filter((z) => z >= TRACE_ZOOM_THRESHOLD)) {
      const centre = radiusAt(paintOf(UNCLUSTERED_POINT_LAYER_ID)['circle-radius'], zoom);
      const start = radiusAt(paintOf('start-point-outer')['circle-radius'], zoom);

      expect(Math.max(centre, start)).toBeGreaterThan(0);
    }
  });

  it('hands the dot to the start point, which is what a tap needs', () => {
    const centre = paintOf(UNCLUSTERED_POINT_LAYER_ID)['circle-radius'];

    expect(radiusAt(centre, TRACE_ZOOM_THRESHOLD)).toBe(0);
    expect(radiusAt(centre, TRACE_ZOOM_THRESHOLD - 0.5)).toBeGreaterThan(0);
  });
});
