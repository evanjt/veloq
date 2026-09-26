/**
 * Scenario: the regional map carries a megabyte of memoised GeoJSON and the
 * user taps a marker, which changes only a paint expression on one layer. And
 * a recording draws a line that gains one point a second for five hours.
 *
 * Expected behaviour: the patch names only what moved, an unchanged memoised
 * source is never serialised to find that out, and a growing line ships the
 * points it gained rather than every point it has.
 */
import {
  createSurfacePatcher,
  diffSpec,
  growingLine,
  planGrowth,
} from '@/features/maps/lib/mapSurfacePatch';
import { buildApplyScript } from '@/features/maps/lib/htmlBuilders';
import type { MapLayerSpec, MapSourceSpec } from '@/features/maps/lib/htmlBuilders';

const points = (n: number, from = 0): GeoJSON.Position[] =>
  Array.from({ length: n }, (_, i) => [7.3 + (from + i) * 0.001, 46.2]);

const line = (coordinates: GeoJSON.Position[], growing = true): MapSourceSpec => ({
  kind: 'geojson',
  growing,
  data: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
  },
});

const collection = (features: number): MapSourceSpec => ({
  kind: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: Array.from({ length: features }, () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [7.3, 46.2] },
    })),
  },
});

const layer = (color: string): MapLayerSpec[] => [
  { id: 'traces', type: 'line', source: 'traces', paint: { 'line-color': color } },
];

describe('planGrowth', () => {
  it('appends only the points the line gained', () => {
    expect(planGrowth(points(3), points(5))).toEqual({
      kind: 'append',
      coordinates: points(2, 3),
    });
  });

  it('says nothing changed when the line is the same length and joins the same', () => {
    expect(planGrowth(points(3), points(3))).toEqual({ kind: 'unchanged' });
  });

  it('sends the whole line when it got shorter, which is a trim', () => {
    expect(planGrowth(points(9), points(4))).toEqual({ kind: 'whole' });
  });

  it('sends the whole line when the start moved', () => {
    expect(planGrowth(points(4), points(6, 2))).toEqual({ kind: 'whole' });
  });

  it('sends the whole line when the join point moved', () => {
    const rewritten = points(6);
    rewritten[3] = [0, 0];
    expect(planGrowth(points(4), rewritten)).toEqual({ kind: 'whole' });
  });

  it('sends the whole line when the page holds nothing yet', () => {
    expect(planGrowth(null, points(4))).toEqual({ kind: 'whole' });
    expect(planGrowth([], points(4))).toEqual({ kind: 'whole' });
  });
});

describe('growingLine', () => {
  it('reads the coordinates of a single-LineString collection that says it grows', () => {
    expect(growingLine(line(points(3)))).toEqual(points(3));
  });

  it('refuses a source that did not say it grows', () => {
    expect(growingLine(line(points(3), false))).toBeNull();
  });

  it('refuses a collection that is not one line', () => {
    expect(growingLine({ ...collection(2), growing: true } as MapSourceSpec)).toBeNull();
  });
});

describe('createSurfacePatcher', () => {
  const traces = collection(1);
  const markersSource = collection(2);

  it('sends everything on the first patch', () => {
    const p = createSurfacePatcher();

    const { patch } = p.next({ sources: { traces, markersSource }, layers: layer('#fff') });

    expect(patch?.sources).toEqual({ traces, markersSource });
  });

  it('serialises no source when only the layers changed', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { traces, markersSource }, layers });

    const selected = layer('#f00');
    const { patch, serialised } = p.next({ sources: { traces, markersSource }, layers: selected });

    expect(patch?.sources).toBeUndefined();
    expect(patch?.layers).toBe(selected);
    // Both sources are compared by identity. Only the layer list is stringified;
    // the absent marker and image lists keep their identity too.
    expect(serialised).toBe(1);
  });

  it('sends nothing at all when nothing moved', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { traces }, layers });

    const { patch, serialised } = p.next({ sources: { traces }, layers });

    expect(patch).toBeNull();
    expect(serialised).toBe(0);
  });

  it('sends the whole map again after the page forgets', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { traces }, layers });

    p.forget();
    const { patch } = p.next({ sources: { traces }, layers });

    expect(patch?.sources).toEqual({ traces });
    expect(patch?.layers).toBe(layers);
  });

  it('carries a removed source as null', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { traces }, layers });

    const { patch } = p.next({ sources: {}, layers });

    expect(patch?.sources).toEqual({ traces: null });
  });

  it('holds back a rebuilt source whose data is unchanged', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { traces: collection(1) }, layers });

    const { patch } = p.next({ sources: { traces: collection(1) }, layers });

    expect(patch).toBeNull();
  });

  it('keeps interactive layers on every patch it sends', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    const interactiveLayers = ['traces'];
    p.next({ sources: { traces }, layers, interactiveLayers });

    const { patch } = p.next({ sources: { traces: collection(3) }, layers, interactiveLayers });

    expect(patch?.interactiveLayers).toBe(interactiveLayers);
  });

  it('ships one fix as one point, not as the whole recording', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { route: line(points(18_000)) }, layers });

    const { patch, serialised } = p.next({ sources: { route: line(points(18_001)) }, layers });

    expect(patch?.appends).toEqual({ route: points(1, 18_000) });
    expect(patch?.sources).toBeUndefined();
    // The line is never stringified, whatever its length.
    expect(serialised).toBe(0);
  });

  it('sends a trimmed recording whole', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { route: line(points(100)) }, layers });

    const trimmed = line(points(40));
    const { patch } = p.next({ sources: { route: trimmed }, layers });

    expect(patch?.sources).toEqual({ route: trimmed });
    expect(patch?.appends).toBeUndefined();
  });

  it('says nothing when a rebuilt line holds the same points', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { route: line(points(50)) }, layers });

    const { patch } = p.next({ sources: { route: line(points(50)) }, layers });

    expect(patch).toBeNull();
  });

  it('sends a growing line whole again after the page forgets', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    p.next({ sources: { route: line(points(50)) }, layers });

    p.forget();
    const grown = line(points(51));
    const { patch } = p.next({ sources: { route: grown }, layers });

    expect(patch?.sources).toEqual({ route: grown });
    expect(patch?.appends).toBeUndefined();
  });
});

describe('diffSpec', () => {
  it('serialises nothing when the list is the same object', () => {
    const layers = layer('#fff');
    const first = diffSpec(undefined, layers);

    const second = diffSpec(first.sent, layers);

    expect(second.changed).toBe(false);
    expect(second.serialised).toBe(0);
  });

  it('holds back a rebuilt list whose contents are unchanged', () => {
    const first = diffSpec(undefined, layer('#fff'));

    const second = diffSpec(first.sent, layer('#fff'));

    expect(second.changed).toBe(false);
    expect(second.serialised).toBe(1);
  });

  it('sends a list whose contents moved', () => {
    const first = diffSpec(undefined, layer('#fff'));

    const second = diffSpec(first.sent, layer('#f00'));

    expect(second.changed).toBe(true);
  });
});

describe('buildApplyScript', () => {
  it('carries the appends the patcher decided on', () => {
    const script = buildApplyScript({ appends: { route: [[7.3, 46.2]] } });

    expect(script).toContain('"appends":{"route":[[7.3,46.2]]}');
  });
});
