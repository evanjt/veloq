/**
 * Scenario: the section map draws every nearby section's line and a start and
 * end dot on each. The lines are decoded once into a FeatureCollection, and
 * the dots used to decode the same polylines a second time.
 *
 * Expected behaviour: the dots come off the lines that were already built.
 */
import { lineEndpoints } from '@/features/maps/lib/coordinates';

const line = (coordinates: GeoJSON.Position[]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: { sectionId: 'sec-1' },
  geometry: { type: 'LineString', coordinates },
});

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

describe('lineEndpoints', () => {
  it('takes the first and last point of each line', () => {
    const result = lineEndpoints(
      collection([
        line([
          [7.1, 46.1],
          [7.2, 46.2],
          [7.3, 46.3],
        ]),
      ])
    );

    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [7.1, 46.1] });
    expect(result.features[0].properties).toEqual({ position: 'start' });
    expect(result.features[1].geometry).toEqual({ type: 'Point', coordinates: [7.3, 46.3] });
    expect(result.features[1].properties).toEqual({ position: 'end' });
  });

  it('returns nothing for an empty collection', () => {
    expect(lineEndpoints(collection([])).features).toEqual([]);
  });

  it('skips a line too short to have two ends', () => {
    expect(lineEndpoints(collection([line([[7.1, 46.1]])])).features).toEqual([]);
  });

  it('skips a feature that is not a line', () => {
    const point: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [7.1, 46.1] },
    };
    expect(lineEndpoints(collection([point])).features).toEqual([]);
  });

  it('keeps the pair of every line', () => {
    const result = lineEndpoints(
      collection([
        line([
          [1, 1],
          [2, 2],
        ]),
        line([
          [3, 3],
          [4, 4],
        ]),
      ])
    );
    expect(result.features.map((f) => (f.geometry as GeoJSON.Point).coordinates)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });
});
