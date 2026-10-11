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
import {
  buildActivityLayers,
  buildActivitySources,
} from '@/features/maps/components/activityMapLayerSpecs';
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

  it('serialises nothing for a fresh wrapper around the same data', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    const data = (collection(3) as { data: unknown }).data;
    const wrap = (extra: object = {}) =>
      ({ kind: 'geojson', data, ...extra }) as unknown as MapSourceSpec;
    p.next({ sources: { traces: wrap() }, layers });

    const same = p.next({ sources: { traces: wrap() }, layers });

    expect(same.serialised).toBe(0);
    expect(same.patch).toBeNull();
  });

  it('still serialises a wrapper whose field or data changed', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    const data = (collection(3) as { data: unknown }).data;
    const wrap = (d: unknown, extra: object = {}) =>
      ({ kind: 'geojson', data: d, ...extra }) as unknown as MapSourceSpec;
    p.next({ sources: { traces: wrap(data) }, layers });

    const metrics = p.next({ sources: { traces: wrap(data, { lineMetrics: true }) }, layers });
    expect(metrics.serialised).toBe(1);
    expect(metrics.patch?.sources).toBeDefined();

    const fresh = p.next({
      sources: { traces: wrap((collection(4) as { data: unknown }).data, { lineMetrics: true }) },
      layers,
    });
    expect(fresh.serialised).toBe(1);
    expect(fresh.patch?.sources).toBeDefined();
  });

  it('sends the images once, since the page keeps them for the patches after', () => {
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    const images = [{ id: 'glyph', uri: 'data:image/png;base64,AAAA', sdf: true }];
    const first = p.next({ sources: { traces }, layers, images });
    expect(first.patch?.images).toBe(images);

    const scrub = p.next({ sources: { traces: collection(4) }, layers, images });
    expect(scrub.patch?.sources).toBeDefined();
    expect(scrub.patch?.images).toBeUndefined();

    p.forget();
    expect(p.next({ sources: { traces }, layers, images }).patch?.images).toBe(images);
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

  it('ships only the new points of a line that grows in place', () => {
    // The live map keeps one flipped array and appends to it, so the line it
    // hands over on the next fix is the same array, longer.
    const p = createSurfacePatcher();
    const layers = layer('#fff');
    const track = points(50);
    p.next({ sources: { route: line(track) }, layers });

    track.push(...points(2, 50));
    const { patch } = p.next({ sources: { route: line(track) }, layers });

    expect(patch?.appends).toEqual({ route: points(2, 50) });
    expect(patch?.sources).toBeUndefined();

    track.push(...points(1, 52));
    const next = p.next({ sources: { route: line(track) }, layers });
    expect(next.patch?.appends).toEqual({ route: points(1, 52) });
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

/** Every character JSON.stringify produces while `run` runs. */
function stringifiedChars(run: () => void): number {
  const stringify = JSON.stringify;
  let chars = 0;
  const spy = jest.spyOn(JSON, 'stringify').mockImplementation(((...args: unknown[]) => {
    const out = (stringify as (...a: unknown[]) => string)(...args);
    if (typeof out === 'string') chars += out.length;
    return out;
  }) as typeof JSON.stringify);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return chars;
}

describe('the first send of a large source', () => {
  // A six-hour ride recorded at one point a second.
  const track = (): GeoJSON.Feature => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points(21_600) },
  });
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  const activitySources = (routeGeoJSON: GeoJSON.Feature) =>
    buildActivitySources({
      routeGeoJSON,
      overlayGeoJSON: empty,
      consolidatedPortionsGeoJSON: empty,
      sectionBoundariesGeoJSON: empty,
      sectionMarkersGeoJSON: empty,
      highlightGeoJSON: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      endpointsGeoJSON: empty,
      sectionCreationLine: empty,
      sectionCreationMarkers: empty,
      userLocationGeoJSON: empty,
    });

  it('carries the activity track in one source, which both route layers draw from', () => {
    const routeGeoJSON = track();
    const sources = activitySources(routeGeoJSON);

    const carrying = Object.keys(sources).filter((id) => {
      const spec = sources[id];
      return spec.kind === 'geojson' && spec.data === routeGeoJSON;
    });
    expect(carrying).toEqual(['route']);
    // The gradient reads line-progress, which only a lineMetrics source has.
    expect(sources.route).toMatchObject({ lineMetrics: true });

    for (const gradientActive of [false, true]) {
      const layers = buildActivityLayers({
        overlayHasData: false,
        activityColor: '#00ff00',
        gradientActive,
        gradientLineExpression: [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0,
          '#000',
          1,
          '#fff',
        ],
        hasSectionOverlays: false,
        hasHighlightPoint: false,
        creationMode: false,
        hasUserLocation: false,
      });
      const routeLayers = layers.filter((l) => l.id.startsWith('route-'));
      expect(routeLayers.map((l) => l.id)).toEqual([
        'route-casing',
        'route-line',
        'route-gradient-line',
      ]);
      expect(routeLayers.every((l) => l.source === 'route')).toBe(true);
      for (const l of layers) expect(Object.keys(sources)).toContain(l.source);
    }
  });

  it('stringifies each source once between the patcher and the script', () => {
    const route = { kind: 'geojson', data: track() } as MapSourceSpec;
    const trackChars = JSON.stringify(route).length;
    const p = createSurfacePatcher();

    let script = '';
    const chars = stringifiedChars(() => {
      const { patch, sourceJson } = p.next({ sources: { route }, layers: layer('#fff') });
      script = buildApplyScript(patch!, sourceJson);
    });

    expect(chars).toBeLessThan(trackChars * 1.1);
    // The script still carries the whole source, as the page reads it.
    const applied = JSON.parse(script.slice(script.indexOf('(') + 1, script.lastIndexOf(')')));
    expect(applied.sources.route).toEqual(JSON.parse(JSON.stringify(route)));
    expect(applied.layers).toEqual(layer('#fff'));
  });

  it('stringifies a changed source once on a later send too', () => {
    const p = createSurfacePatcher();
    p.next({
      sources: { route: { kind: 'geojson', data: track() } as MapSourceSpec },
      layers: layer('#fff'),
    });

    const moved = track();
    (moved.geometry as GeoJSON.LineString).coordinates[0] = [0, 0];
    const route = { kind: 'geojson', data: moved } as MapSourceSpec;
    const trackChars = JSON.stringify(route).length;

    let script = '';
    const chars = stringifiedChars(() => {
      const { patch, sourceJson } = p.next({ sources: { route }, layers: layer('#fff') });
      script = buildApplyScript(patch!, sourceJson);
    });

    expect(chars).toBeLessThan(trackChars * 1.1);
    expect(script).toContain('"coordinates":[[0,0],');
  });

  it('builds the same script with or without the strings the patcher kept', () => {
    const p = createSurfacePatcher();
    const sources = { traces: collection(3), gone: collection(1) };
    p.next({ sources, layers: layer('#fff') });

    const { patch, sourceJson } = p.next({
      sources: { traces: collection(4) },
      layers: layer('#f00'),
      interactiveLayers: ['traces'],
    });

    expect(patch?.sources).toEqual({ traces: collection(4), gone: null });
    expect(buildApplyScript(patch!, sourceJson)).toBe(buildApplyScript(patch!));
  });
});
