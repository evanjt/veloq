/**
 * Scenario: the activity map enters 3D with a section highlighted, the matched route, the
 * scrub highlight, the location dot and section creation all drawn. 3D is the same map tilted
 * over terrain, so its layers come from the same builder with terrain on.
 *
 * Expected behaviour: terrain on and off give the same layers in the same order with the same
 * sources, filters, layout, colours, opacities and dashes. Every line width, circle radius and
 * ring width is the flat one times `MAP_3D_SCALE`, highlighted or not.
 */

import { mapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { MAP_3D_SCALE } from '@/features/maps/lib/mapLineWidths';
import {
  buildActivityLayers,
  type ActivityLayerInput,
} from '@/features/maps/components/activityMapLayerSpecs';

/** The paint keys a 3D page draws at `MAP_3D_SCALE`. */
const SIZE_KEYS = ['line-width', 'circle-radius', 'circle-stroke-width'];

type Feature = Record<string, unknown>;

/** Reads the expressions these layers size with. Any other operator throws, so it cannot pass. */
function evaluate(expression: unknown, feature: Feature): unknown {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression as [string, ...unknown[]];
  const at = (value: unknown) => evaluate(value, feature);
  switch (op) {
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
    default:
      throw new Error(`unknown expression operator ${op}`);
  }
}

const FEATURES: Feature[] = [{ id: 'chosen-section' }, { id: 'another-section' }];

function inputs(): ActivityLayerInput[] {
  const base: ActivityLayerInput = {
    palette: mapPalette('light'),
    overlayHasData: true,
    gradientActive: false,
    gradientLineExpression: null,
    hasSectionOverlays: true,
    highlightedSectionId: null,
    hasHighlightPoint: true,
    creationMode: true,
    hasUserLocation: true,
  };
  return [
    base,
    { ...base, highlightedSectionId: 'chosen-section' },
    {
      ...base,
      gradientActive: true,
      gradientLineExpression: ['interpolate', ['linear'], 0, 0, '#000'],
    },
  ];
}

/** The endpoint glyph is drawn inside its disc, so it takes the disc's scale. */
const ENDPOINT_GLYPH = 'endpoint-icon';

/** A layer with its sized paint taken out, which is all terrain may not touch. */
function withoutSizes(layer: MapLayerSpec): MapLayerSpec {
  const paint = { ...(layer.paint ?? {}) } as Record<string, unknown>;
  for (const key of SIZE_KEYS) delete paint[key];
  const layout = { ...(layer.layout ?? {}) } as Record<string, unknown>;
  if (layer.id === ENDPOINT_GLYPH) delete layout['icon-size'];
  return { ...layer, paint, layout };
}

describe.each(inputs().map((input, index) => [index, input] as const))(
  'the activity map in 3D draws the 2D layers (input %i)',
  (_index, input) => {
    const flat = buildActivityLayers({ ...input, terrain: false });
    const tilted = buildActivityLayers({ ...input, terrain: true });

    it('in the same order, with everything but sizes unchanged', () => {
      expect(tilted.map((layer) => layer.id)).toEqual(flat.map((layer) => layer.id));
      expect(tilted.map(withoutSizes)).toEqual(flat.map(withoutSizes));
    });

    it('with every width and radius at the 3D scale, highlighted or not', () => {
      let compared = 0;
      flat.forEach((layer, index) => {
        const flatPaint = (layer.paint ?? {}) as Record<string, unknown>;
        const tiltedPaint = (tilted[index]!.paint ?? {}) as Record<string, unknown>;
        for (const key of SIZE_KEYS) {
          if (!(key in flatPaint)) {
            expect(key in tiltedPaint).toBe(false);
            continue;
          }
          for (const feature of FEATURES) {
            const flatSize = evaluate(flatPaint[key], feature) as number;
            const tiltedSize = evaluate(tiltedPaint[key], feature) as number;
            expect(typeof flatSize).toBe('number');
            expect(tiltedSize).toBeCloseTo(flatSize * MAP_3D_SCALE, 9);
            compared += 1;
          }
        }
      });
      expect(compared).toBeGreaterThan(0);
    });

    it('with the endpoint glyph scaled with its disc', () => {
      const glyph = (layers: MapLayerSpec[]) =>
        layers.find((layer) => layer.id === ENDPOINT_GLYPH)!.layout!['icon-size'] as number;
      expect(glyph(tilted)).toBeCloseTo(glyph(flat) * MAP_3D_SCALE, 9);
    });
  }
);

describe('the activity map layers without terrain', () => {
  it('are the flat layers whether terrain is absent or false', () => {
    const [input] = inputs();
    expect(buildActivityLayers({ ...input!, terrain: false })).toEqual(buildActivityLayers(input!));
  });
});
