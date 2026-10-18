import {
  buildRouteLayers,
  buildRouteSources,
} from '@/features/routes/components/routeMapLayerSpecs';
import { deltaLineBands, type LineBand } from '@/features/maps/lib/deltaLineColor';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
const palette = mapPalette('light');

const layers = (bands: LineBand[] | null) =>
  buildRouteLayers({
    palette,
    routeContext: false,
    fadedFilter: undefined,
    includeRoute: true,
    deltaBands: bands,
  });
const routeLine = (bands: LineBand[] | null) =>
  layers(bands).find((layer) => layer.id === 'route-line')!;

describe('route map delta line', () => {
  it('declares the route source with line metrics', () => {
    expect(buildRouteSources({}, empty).route).toMatchObject({ lineMetrics: true });
  });

  it('steps the line over line-progress in the base ramp while it is banded', () => {
    const bands = deltaLineBands([-4, 2], 100, 200, 'forward');
    const paint = routeLine(bands).paint as Record<string, unknown>;
    expect(paint['line-gradient']).toEqual([
      'step',
      ['line-progress'],
      palette.div['cool-2'],
      0.5,
      palette.div['warm-1'],
    ]);
    expect(paint['line-color']).toBeUndefined();
  });

  it('keeps the flat colour when nothing is banded', () => {
    const paint = routeLine(null).paint as Record<string, unknown>;
    expect(paint['line-color']).toBe(palette.route);
    expect(paint['line-gradient']).toBeUndefined();
  });

  it('dashes the stretches with no data in the muted colour, over the route', () => {
    const drawn = layers(null);
    const gap = drawn.find((layer) => layer.id === 'delta-gap-line')!;
    expect(gap.source).toBe('delta-gaps');
    expect(gap.paint).toMatchObject({ 'line-color': palette.muted, 'line-dasharray': [2, 2] });
    expect(drawn.indexOf(gap)).toBeGreaterThan(drawn.findIndex((l) => l.id === 'route-line'));
  });

  it('dashes them on the fullscreen map, which draws the route itself', () => {
    const fullscreen = buildRouteLayers({
      palette,
      routeContext: false,
      fadedFilter: undefined,
      includeRoute: false,
    });
    expect(fullscreen.some((layer) => layer.id === 'delta-gap-line')).toBe(true);
  });
});
