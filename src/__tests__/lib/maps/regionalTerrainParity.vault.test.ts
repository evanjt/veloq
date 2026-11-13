/**
 * Scenario: the map tab enters 3D with a section, a route and an activity
 * selected, the activity fanned out beside its neighbours and the location dot
 * drawn. 3D is the same map tilted over terrain, so its layers come from the
 * same builder with terrain on.
 *
 * Expected behaviour: terrain on and off give the same layers in the same
 * order with the same sources, filters, layout, colours, opacities and dashes.
 * Every line width, circle radius and ring width is the flat one times
 * `MAP_3D_SCALE`, at every zoom and for the selected feature and the rest.
 */

import { mapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { MAP_3D_SCALE } from '@/features/maps/lib/mapLineWidths';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';

/** The paint keys a 3D page draws at `MAP_3D_SCALE`. */
const SIZE_KEYS = ['line-width', 'circle-radius', 'circle-stroke-width'];

type Feature = Record<string, unknown>;

/**
 * Reads a MapLibre expression for one feature at one zoom. Only the operators
 * these layers size with are known, and any other throws, so a width written
 * in a new shape is a failure here rather than a pass.
 */
function evaluate(expression: unknown, zoom: number, feature: Feature): unknown {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression as [string, ...unknown[]];
  const at = (value: unknown) => evaluate(value, zoom, feature);
  switch (op) {
    case 'zoom':
      return zoom;
    case 'get':
      return feature[args[0] as string];
    case '==':
      return at(args[0]) === at(args[1]);
    case 'case': {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (at(args[i])) return at(args[i + 1]);
      }
      return at(args[args.length - 1]);
    }
    case 'step': {
      const input = at(args[0]) as number;
      let output = at(args[1]);
      for (let i = 2; i + 1 < args.length; i += 2) {
        if (input >= (args[i] as number)) output = at(args[i + 1]);
      }
      return output;
    }
    case 'interpolate': {
      const input = at(args[1]) as number;
      const stops: [number, number][] = [];
      for (let i = 2; i + 1 < args.length; i += 2) {
        stops.push([args[i] as number, at(args[i + 1]) as number]);
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      if (input <= first[0]) return first[1];
      if (input >= last[0]) return last[1];
      const upper = stops.findIndex(([stop]) => stop >= input);
      const [z0, v0] = stops[upper - 1]!;
      const [z1, v1] = stops[upper]!;
      return v0 + ((input - z0) / (z1 - z0)) * (v1 - v0);
    }
    default:
      throw new Error(`unknown expression operator ${op}`);
  }
}

const ZOOMS = [0, 4, 6, 8, 10, 11, 12, 13, 14, 16, 18, 20];
const FEATURES: Feature[] = [
  { id: 'chosen-section', point_count: 4 },
  { id: 'chosen-route', point_count: 12 },
  { id: 'chosen-activity', point_count: 60 },
  { id: 'someone-else', point_count: 1 },
];

/** Everything selected, fanned out and located, so every case expression is live. */
const SELECTION = {
  palette: mapPalette('light'),
  showActivities: true,
  showSections: true,
  showRoutes: true,
  showHeatmap: true,
  heatmapEnabled: true,
  hasSpider: true,
  hasUserLocation: true,
  hasRouteData: true,
  selectedActivityId: 'chosen-activity',
  selectedSectionId: 'chosen-section',
  selectedRouteId: 'chosen-route',
  routeColor: '#123456',
};

function layersWith(terrain: boolean): MapLayerSpec[] {
  return buildRegionalLayers({ ...SELECTION, terrain });
}

/** A layer with its sized paint taken out, which is all terrain may not touch. */
function withoutSizes(layer: MapLayerSpec): MapLayerSpec {
  const paint = { ...(layer.paint ?? {}) } as Record<string, unknown>;
  for (const key of SIZE_KEYS) delete paint[key];
  return { ...layer, paint };
}

describe('the map tab in 3D draws the 2D layers', () => {
  const flat = layersWith(false);
  const tilted = layersWith(true);

  it('in the same order, with everything but sizes unchanged', () => {
    expect(tilted.map((layer) => layer.id)).toEqual(flat.map((layer) => layer.id));
    expect(tilted.map(withoutSizes)).toEqual(flat.map(withoutSizes));
  });

  it('with every width and radius at the 3D scale, selected or not, at every zoom', () => {
    let compared = 0;
    flat.forEach((layer, index) => {
      const flatPaint = (layer.paint ?? {}) as Record<string, unknown>;
      const tiltedPaint = (tilted[index]!.paint ?? {}) as Record<string, unknown>;
      for (const key of SIZE_KEYS) {
        if (!(key in flatPaint)) {
          expect(key in tiltedPaint).toBe(false);
          continue;
        }
        for (const zoom of ZOOMS) {
          for (const feature of FEATURES) {
            const flatSize = evaluate(flatPaint[key], zoom, feature) as number;
            const tiltedSize = evaluate(tiltedPaint[key], zoom, feature) as number;
            expect(typeof flatSize).toBe('number');
            expect(tiltedSize).toBeCloseTo(flatSize * MAP_3D_SCALE, 9);
            compared += 1;
          }
        }
      }
    });
    expect(compared).toBeGreaterThan(0);
  });

  it('casing the selected section and dimming the rest, as 2D does', () => {
    const sections = tilted.find((layer) => layer.id === 'sections-line')!;
    const width = (sections.paint as Record<string, unknown>)['line-width'];
    const chosen = evaluate(width, 12, { id: 'chosen-section' }) as number;
    const other = evaluate(width, 12, { id: 'someone-else' }) as number;
    expect(chosen).toBeGreaterThan(other);
    const opacity = (sections.paint as Record<string, unknown>)['line-opacity'];
    expect(evaluate(opacity, 12, { id: 'chosen-section' })).toBe(1);
    expect(evaluate(opacity, 12, { id: 'someone-else' }) as number).toBeLessThan(1);
  });

  it('flat by default, so a caller that never asks for terrain draws the 2D sizes', () => {
    expect(buildRegionalLayers(SELECTION)).toEqual(flat);
  });
});
