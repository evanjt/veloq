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
  boundsOf,
  crosshairData,
  layerInput,
  nearestIndex,
  overlaySectionIds,
  positionAt,
  splitOverlay,
  trackPositions,
  trackUrl,
  type ActivityMapInput,
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
    expect(spec.layers).toEqual(buildActivityLayers(layerInput(given)));
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
