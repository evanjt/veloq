/**
 * Scenario: the section page lays its merge candidates over the section's map.
 *
 * Expected behaviour: each candidate is a line keyed by its section id, longitude first; a
 * candidate with fewer than two points is left out; with no candidates the section's own spec is
 * returned as it is; and with some, the candidate layers are added and the section's kept.
 * While the ends are edited the part the ends can reach and the part they keep are two more
 * lines over the section, the kept one drawn last, and the section's own layers stay.
 */

import {
  boundsEditorSpec,
  candidateCollection,
  sectionMapSpec,
} from '../../../web/connect/map/sectionLayers';
import { sectionDetailSpec } from '../../../web/connect/map/routeLayers';

const BASE = {} as never;

describe('the candidate lines', () => {
  it('writes longitude then latitude and drops a line with fewer than two points', () => {
    const collection = candidateCollection([
      {
        id: 'a',
        points: [
          [46.5, 6.6],
          [46.6, 6.7],
        ],
      },
      { id: 'b', points: [[46.5, 6.6]] },
    ]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      id: 'a',
      properties: { id: 'a' },
      geometry: {
        coordinates: [
          [6.6, 46.5],
          [6.7, 46.6],
        ],
      },
    });
  });
});

describe('the section map spec', () => {
  it('is the section spec unchanged with no candidates', () => {
    expect(sectionMapSpec(BASE, 's1', null, [], [], null)).toEqual(
      sectionDetailSpec(BASE, 's1', null, [])
    );
  });

  it('keeps the section layers and adds the candidates, lighting the one asked', () => {
    const plain = sectionDetailSpec(BASE, 's1', null, []);
    const spec = sectionMapSpec(
      BASE,
      's1',
      null,
      [],
      [
        {
          id: 'x',
          points: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
      'x'
    );
    expect(spec.layers.slice(0, plain.layers.length)).toEqual(plain.layers);
    expect(spec.layers.map((layer) => layer.id)).toEqual([
      ...plain.layers.map((layer) => layer.id),
      'candidates',
      'candidate-lit',
    ]);
    expect(spec.layers.at(-1)?.filter).toEqual(['==', ['get', 'id'], 'x']);
    expect(spec.interactiveLayers).toContain('candidates');
    expect(Object.keys(spec.sources)).toEqual(expect.arrayContaining(['section', 'candidates']));
  });
});

describe('the stored versions shown under the section', () => {
  it('adds one line source per shown version beneath the section line, and none for no version', () => {
    const plain = sectionMapSpec(BASE, 's1', null, [], [], null);
    expect(sectionMapSpec(BASE, 's1', null, [], [], null, [])).toEqual(plain);

    const spec = sectionMapSpec(BASE, 's1', null, [], [], null, [2, 1]);
    expect(spec.sources['section-version-2']).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/section-version/2%3As1',
    });
    expect(spec.sources['section-version-1']).toMatchObject({ kind: 'geojson' });
    const ids = spec.layers.map((layer) => layer.id);
    expect(ids.indexOf('section-version-2')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('section-version-2')).toBeLessThan(ids.indexOf('section'));
    expect(ids.indexOf('section-version-1')).toBeLessThan(ids.indexOf('section'));
    expect(
      spec.layers
        .map((layer) => layer.id)
        .filter((id) => id !== 'section-version-2' && id !== 'section-version-1')
    ).toEqual(plain.layers.map((layer) => layer.id));
  });
});

describe('the bounds editor lines', () => {
  const path: [number, number][] = Array.from({ length: 12 }, (_, at) => [7 + at * 0.001, 46]);
  const plain = sectionMapSpec(BASE, 's1', null, [], [], null);

  it('draws the reachable window and the kept span over the section, keeping its layers', () => {
    const spec = boundsEditorSpec(plain, {
      path,
      window: { start: 2, end: 10 },
      span: { start: 4, end: 8 },
    });
    expect(spec.layers.map((layer) => layer.id)).toEqual([
      ...plain.layers.map((layer) => layer.id),
      'bounds-window',
      'bounds-kept',
    ]);
    const lineOf = (id: string) =>
      (spec.sources[id] as { data: GeoJSON.FeatureCollection }).data.features[0]?.geometry as
        GeoJSON.LineString | undefined;
    expect(lineOf('bounds-window')?.coordinates).toEqual(path.slice(2, 11));
    expect(lineOf('bounds-kept')?.coordinates).toEqual(path.slice(4, 9));
  });

  it('draws no line for a span of one vertex', () => {
    const spec = boundsEditorSpec(plain, {
      path,
      window: { start: 0, end: 11 },
      span: { start: 5, end: 5 },
    });
    expect(
      (spec.sources['bounds-kept'] as { data: GeoJSON.FeatureCollection }).data.features
    ).toEqual([]);
  });
});
