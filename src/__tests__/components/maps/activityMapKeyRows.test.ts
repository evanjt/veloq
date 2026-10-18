/**
 * Expected behaviour: every colour the activity map draws has a row in its key,
 * on every base, and the key names nothing the map is not drawing.
 */
import { mapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { buildActivityLayers } from '@/features/maps/components/activityMapLayerSpecs';
import {
  activityKeyRows,
  keyedColours,
  unkeyedColours,
  UNKEYED_LAYER_PREFIXES,
  type ActivityKeyInput,
} from '@/features/maps/components/activityMapKey';
import {
  buildGradientLineStops,
  gradientStepExpression,
} from '@/features/maps/lib/gradientLineColor';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

const COLOUR = /^(#|rgb)/i;

function coloursIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string' && COLOUR.test(value)) into.add(value.toUpperCase());
  else if (Array.isArray(value)) value.forEach((v) => coloursIn(v, into));
}

const OPACITY_KEYS = ['line-opacity', 'circle-opacity', 'icon-opacity', 'text-opacity'];
const COLOUR_KEYS = ['line-color', 'line-gradient', 'circle-color', 'icon-color'];

/** A layer at a literal zero opacity, or switched off, draws nothing. */
function drawn(layer: MapLayerSpec): boolean {
  if (layer.visible === false) return false;
  const paint = (layer.paint ?? {}) as Record<string, unknown>;
  return !OPACITY_KEYS.some((key) => paint[key] === 0);
}

function drawnColours(layers: MapLayerSpec[]): Set<string> {
  const colours = new Set<string>();
  for (const layer of layers) {
    if (!drawn(layer)) continue;
    if (UNKEYED_LAYER_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) continue;
    const paint = (layer.paint ?? {}) as Record<string, unknown>;
    // The solid line gives way to the gradient, which carries its own colours.
    const keys =
      layer.id === 'route-gradient-line' && paint['line-gradient']
        ? ['line-gradient']
        : COLOUR_KEYS;
    keys.forEach((key) => coloursIn(paint[key], colours));
  }
  return colours;
}

// Every grade step from a steep descent to a steep climb.
const GRADES = [-15, -9, -5, -2, 0, 2, 5, 9, 15];

function scenario(
  mapStyle: MapStyleType,
  overrides: Partial<Omit<ActivityKeyInput, 'palette'>>
): { layers: MapLayerSpec[]; keyed: Set<string>; palette: ReturnType<typeof mapPalette> } {
  const palette = mapPalette(mapStyle);
  const input = {
    overlayHasData: false,
    gradientActive: false,
    hasSectionOverlays: false,
    hasRecord: false,
    highlightedSectionId: null,
    ...overrides,
  };
  const stops = buildGradientLineStops(
    GRADES,
    GRADES.map((_, i) => i * 100),
    mapStyle
  );
  const layers = buildActivityLayers({
    palette,
    overlayHasData: input.overlayHasData,
    gradientActive: input.gradientActive,
    gradientLineExpression: input.gradientActive && stops ? gradientStepExpression(stops) : null,
    hasSectionOverlays: input.hasSectionOverlays,
    highlightedSectionId: input.highlightedSectionId,
    hasHighlightPoint: true,
    creationMode: false,
    hasUserLocation: true,
  });
  const keyed = new Set(
    [...keyedColours(activityKeyRows({ palette, ...input }))].map((c) => c.toUpperCase())
  );
  return { layers, keyed, palette };
}

const STYLES: MapStyleType[] = ['light', 'dark', 'satellite'];

const SCENARIOS: Record<string, Partial<Omit<ActivityKeyInput, 'palette'>>> = {
  'the plain line': {},
  'the matched route under the line': { overlayHasData: true },
  'the line coloured by grade': { gradientActive: true, overlayHasData: true },
  'section portions with a record': { hasSectionOverlays: true, hasRecord: true },
  'one section highlighted': {
    hasSectionOverlays: true,
    hasRecord: true,
    overlayHasData: true,
    highlightedSectionId: 'harbour-steps',
  },
};

describe('activity map key', () => {
  for (const mapStyle of STYLES) {
    for (const [name, overrides] of Object.entries(SCENARIOS)) {
      it(`names every colour drawn on the ${mapStyle} base for ${name}`, () => {
        const { layers, keyed, palette } = scenario(mapStyle, overrides);
        const outlines = new Set(unkeyedColours(palette).map((c) => c.toUpperCase()));
        const missing = [...drawnColours(layers)].filter((c) => !keyed.has(c) && !outlines.has(c));
        expect(missing).toEqual([]);
      });
    }
  }

  it('keys all seven grade steps while the line is coloured by grade', () => {
    const { keyed, palette } = scenario('light', { gradientActive: true });
    for (const colour of Object.values(palette.div))
      expect(keyed.has(colour.toUpperCase())).toBe(true);
  });

  it('names nothing the map is not drawing', () => {
    expect(
      activityKeyRows({
        palette: mapPalette('light'),
        overlayHasData: false,
        gradientActive: false,
        hasSectionOverlays: false,
        hasRecord: false,
      })
    ).toEqual([]);
  });

  it('names no record when the sections drawn hold none', () => {
    const rows = activityKeyRows({
      palette: mapPalette('dark'),
      overlayHasData: false,
      gradientActive: false,
      hasSectionOverlays: true,
      hasRecord: false,
    });
    expect(rows.map((row) => row.id)).toEqual([]);
  });

  it('names the muted line as the activity, not the matched route, while a section is highlighted', () => {
    const rows = activityKeyRows({
      palette: mapPalette('light'),
      overlayHasData: true,
      gradientActive: false,
      hasSectionOverlays: true,
      hasRecord: false,
      highlightedSectionId: 'harbour-steps',
    });
    expect(rows.map((row) => row.id)).toEqual(['selected-section', 'activity']);
  });
});
