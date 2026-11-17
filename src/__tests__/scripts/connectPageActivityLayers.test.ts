/**
 * Scenario: the activity page's map slot marks the chart's crosshair on the
 * track, draws the engine's overlay with the phone's layers, and draws
 * compared tracks over the line.
 *
 * Expected behaviour: a stream index maps to the track's i-th position and
 * clamps at both ends; an empty track has no marker; the overlay text is split
 * by kind into the sources the phone's layers read; the layer list is the one
 * the phone's builder makes for the same input.
 */

import { buildActivityLayers } from '@/features/maps/components/activityMapLayerSpecs';

import {
  activityMapSpec,
  NO_OVERLAY,
  boundsOf,
  crosshairData,
  layerInput,
  nearestIndex,
  overlaySectionIds,
  positionAt,
  rangeData,
  rangeLine,
  splitOverlay,
  trackPositions,
  trackSamples,
  trackUrl,
  type ActivityMapInput,
  type LngLat,
} from '../../../web/connect/map/activityLayers';

const track = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [7.3, 46.2],
          [7.31, 46.21],
          [7.32, 46.22],
        ],
      },
    },
  ],
});

describe('the crosshair on the track', () => {
  const positions = trackPositions(track);

  it('maps a stream index to the track position at that index', () => {
    expect(positionAt(positions, 1)).toEqual([7.31, 46.21]);
  });

  it('clamps below the first and above the last position', () => {
    expect(positionAt(positions, -4)).toEqual([7.3, 46.2]);
    expect(positionAt(positions, 99)).toEqual([7.32, 46.22]);
  });

  it('has no position on an empty track, or for an index that is not a number', () => {
    expect(positionAt([], 0)).toBeNull();
    expect(positionAt(positions, Number.NaN)).toBeNull();
    expect(trackPositions('{"type":"FeatureCollection","features":[]}')).toEqual([]);
    expect(trackPositions('not json')).toEqual([]);
  });

  it('writes a point at the index and none while the crosshair is off', () => {
    expect(crosshairData(positions, 2)?.geometry.coordinates).toEqual([7.32, 46.22]);
    expect(crosshairData(positions, null)).toBeNull();
  });

  it('finds the index nearest a pointer over the line', () => {
    expect(nearestIndex(positions, [7.3099, 46.2101])).toBe(1);
    expect(nearestIndex([], [0, 0])).toBeNull();
  });

  it('fits every track it is given', () => {
    expect(boundsOf([positions, [[8, 47]]])).toEqual([
      [7.3, 46.2],
      [8, 47.0],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});

describe('a brushed range on the track', () => {
  const positions = trackPositions(track);

  it('writes the line through the positions of the range, both ends included', () => {
    expect(rangeData(positions, { from: 1, to: 2 })?.geometry.coordinates).toEqual([
      [7.31, 46.21],
      [7.32, 46.22],
    ]);
  });

  it('clamps to the track and has no line for no range, an empty track or one position', () => {
    expect(rangeData(positions, { from: -5, to: 99 })?.geometry.coordinates).toHaveLength(3);
    expect(rangeData(positions, null)).toBeNull();
    expect(rangeData([], { from: 0, to: 4 })).toBeNull();
    expect(rangeData(positions, { from: 1, to: 1 })).toBeNull();
  });

  it('is drawn by a layer of its own when the spec is given a range, and by none otherwise', () => {
    const base = { activityId: 'a', revision: 1, overlay: NO_OVERLAY } as never;
    const input = {
      ...(base as object),
      base: 'light',
      crosshair: null,
      highlightedSectionId: null,
      compare: [],
    };
    const without = activityMapSpec(input as never);
    expect(without.layers.some((layer) => layer.id === 'brush-range')).toBe(false);
    const range = rangeLine(positions, { from: 0, to: 2 });
    const spec = activityMapSpec({ ...input, range } as never);
    expect(spec.layers.some((layer) => layer.id === 'brush-range')).toBe(true);
    expect(spec.sources['brush-range']).toEqual({ kind: 'geojson', data: range });
  });
});

describe('the overlay', () => {
  const feature = (kind: string, id: string) => ({
    type: 'Feature',
    properties: { kind, id },
    geometry: { type: 'Point', coordinates: [0, 0] },
  });
  const text = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      feature('section', 's_a'),
      feature('section', 's_b'),
      feature('portion', 's_a'),
      feature('pr', 's_a'),
    ],
  });

  it('splits by kind into the three sources, keeping the section order', () => {
    const overlay = splitOverlay(text);
    expect(overlaySectionIds(overlay)).toEqual(['s_a', 's_b']);
    expect(overlay.portions.features).toHaveLength(1);
    expect(overlay.markers.features).toHaveLength(1);
  });

  it('is empty for an empty collection and for text that is not one', () => {
    for (const empty of ['{"type":"FeatureCollection","features":[]}', 'nope']) {
      const overlay = splitOverlay(empty);
      expect(overlay.sections.features).toEqual([]);
      expect(overlay.portions.features).toEqual([]);
    }
  });
});

describe('the spec', () => {
  const input = (patch: Partial<ActivityMapInput> = {}): ActivityMapInput => ({
    base: 'light',
    activityId: 'a/1',
    revision: 4,
    overlay: splitOverlay(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'section', id: 's_a' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
        ],
      })
    ),
    crosshair: null,
    highlightedSectionId: null,
    compare: [],
    ...patch,
  });

  it('draws the layers the phone builds for the same input', () => {
    const given = input({ highlightedSectionId: 's_a' });
    const spec = activityMapSpec(given);
    const phone = buildActivityLayers(layerInput(given));
    expect(spec.layers.slice(0, phone.length)).toEqual(phone);
    expect(spec.layers.slice(phone.length).map((l) => l.id)).toEqual([
      'section-number',
      'range-line',
    ]);
  });

  it('names the stored track by url with its revision', () => {
    const spec = activityMapSpec(input());
    expect(spec.sources.route).toMatchObject({ kind: 'geojson', data: trackUrl('a/1', 4) });
    expect(trackUrl('a/1', 4)).toBe('veloq://geo/track/a%2F1?v=4');
  });

  it('adds a source and a line per compared track, in its colour, over the layers', () => {
    const own = activityMapSpec(input());
    const spec = activityMapSpec(
      input({
        compare: [
          { id: 'b', colour: 'line-1' },
          { id: 'c', colour: 'line-0' },
        ],
      })
    );
    expect(spec.layers.slice(0, own.layers.length)).toEqual(own.layers);
    expect(spec.layers.slice(own.layers.length).map((l) => l.id)).toEqual([
      'compare-b',
      'compare-c',
    ]);
    expect(spec.layers.at(-2)?.paint?.['line-color']).toBe('#00798c');
  });

  it('moves the marker source with the crosshair', () => {
    const at = crosshairData([[7.3, 46.2]], 0);
    const spec = activityMapSpec(input({ crosshair: at }));
    expect(spec.sources.highlight).toMatchObject({ data: at });
  });
});

describe('the brushed range on the track', () => {
  const long: LngLat[] = Array.from({ length: 400 }, (_, i) => [7 + i / 1000, 46 + i / 2000]);

  it('draws the stretch of the track from the first to the last sample as one line', () => {
    const line = rangeLine(long, { from: 120, to: 340 });
    const coordinates = (line.features[0]?.geometry as GeoJSON.LineString).coordinates;
    expect(coordinates[0]).toEqual(long[120]);
    expect(coordinates[coordinates.length - 1]).toEqual(long[340]);
    expect(coordinates).toHaveLength(221);
  });

  it('is empty for no range, an empty track, or a range that is not on the track', () => {
    expect(rangeLine(long, null).features).toEqual([]);
    expect(rangeLine([], { from: 0, to: 5 }).features).toEqual([]);
    expect(rangeLine(long, { from: 500, to: 600 }).features).toEqual([]);
  });

  it('clamps a range past the end and a single sample draws nothing', () => {
    const line = rangeLine(long, { from: 390, to: 900 });
    expect((line.features[0]?.geometry as GeoJSON.LineString).coordinates).toHaveLength(10);
    expect(rangeLine(long, { from: 7, to: 7 }).features).toEqual([]);
  });

  it('adds a source and a layer to the spec that read the range', () => {
    const spec = activityMapSpec({
      base: 'light',
      activityId: 'a',
      revision: 1,
      overlay: splitOverlay('{}'),
      crosshair: null,
      highlightedSectionId: null,
      compare: [],
      range: rangeLine(long, { from: 1, to: 9 }),
    });
    expect(spec.sources['range']).toBeDefined();
    expect(spec.layers.some((layer) => layer.id === 'range-line')).toBe(true);
  });
});

describe('a track with a GPS gap', () => {
  const gapped = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [7.3, 46.2],
            [null, null],
            [7.32, 46.22],
            [7.33, 46.23],
          ],
        },
      },
    ],
  });

  it('keeps every stream index, a gap being a null sample', () => {
    const samples = trackSamples(gapped);
    expect(samples).toHaveLength(4);
    expect(samples[1]).toBeNull();
    expect(trackPositions(gapped)).toEqual([
      [7.3, 46.2],
      [7.32, 46.22],
      [7.33, 46.23],
    ]);
  });

  it('puts the marker for stream index i on sample i, and none inside the gap', () => {
    const samples = trackSamples(gapped);
    expect(positionAt(samples, 2)).toEqual([7.32, 46.22]);
    expect(crosshairData(samples, 3)?.geometry.coordinates).toEqual([7.33, 46.23]);
    expect(crosshairData(samples, 1)).toBeNull();
  });

  it('finds the nearest index among real samples only', () => {
    expect(nearestIndex(trackSamples(gapped), [7.3199, 46.2199])).toBe(2);
  });

  it('cuts a range without the gap in its line', () => {
    const line = rangeLine(trackSamples(gapped), { from: 0, to: 3 });
    expect(line.features[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [7.3, 46.2],
        [7.32, 46.22],
        [7.33, 46.23],
      ],
    });
  });
});
