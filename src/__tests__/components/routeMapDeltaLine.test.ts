import {
  buildRouteLayers,
  buildRouteSources,
} from '@/features/routes/components/routeMapLayerSpecs';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

const routeLine = (stops: (string | number)[] | null) =>
  buildRouteLayers({
    palette: mapPalette('light'),
    activityColor: '#123456',
    representativeOpacity: 1,
    fadedOpacity: 0.2,
    fadedFilter: undefined,
    includeRoute: true,
    deltaLineStops: stops,
  }).find((layer) => layer.id === 'route-line')!;

describe('route map delta line', () => {
  it('declares the route source with line metrics', () => {
    expect(buildRouteSources({}, empty).route).toMatchObject({ lineMetrics: true });
  });

  it('paints a line-gradient over line-progress while delta stops are given', () => {
    const paint = routeLine([0, '#000000', 1, '#ffffff']).paint as Record<string, unknown>;
    expect(paint['line-gradient']).toEqual([
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      '#000000',
      1,
      '#ffffff',
    ]);
    expect(paint['line-color']).toBeUndefined();
  });

  it('keeps the flat colour without delta stops', () => {
    const paint = routeLine(null).paint as Record<string, unknown>;
    expect(paint['line-color']).toBe('#123456');
    expect(paint['line-gradient']).toBeUndefined();
  });
});
