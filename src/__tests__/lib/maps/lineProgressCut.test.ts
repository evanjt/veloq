/**
 * Scenario: a stretch of a line with no data is drawn by its own dashed layer,
 * so the stretch is cut out of the line as geometry at the fractions of its
 * length that line-progress reads.
 */

import { cutLineByProgress } from '@/features/maps/lib/lineProgressCut';

/** Four points due east along the equator, 0.001 degrees apart: three equal lengths. */
const LINE: [number, number][] = [
  [0, 0],
  [0.001, 0],
  [0.002, 0],
  [0.003, 0],
];

const coordsOf = (collection: GeoJSON.FeatureCollection) =>
  collection.features.map((feature) =>
    (feature.geometry as GeoJSON.LineString).coordinates.map(([lng, lat]) => [
      Number(lng!.toFixed(7)),
      Number(lat!.toFixed(7)),
    ])
  );

describe('cutLineByProgress', () => {
  it('cuts a range that starts and ends between two points', () => {
    expect(coordsOf(cutLineByProgress(LINE, [[0.5, 5 / 6]]))).toEqual([
      [
        [0.0015, 0],
        [0.002, 0],
        [0.0025, 0],
      ],
    ]);
  });

  it('cuts each range into its own line, ends included', () => {
    expect(
      coordsOf(
        cutLineByProgress(LINE, [
          [0, 1 / 3],
          [2 / 3, 1],
        ])
      )
    ).toEqual([
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [0.002, 0],
        [0.003, 0],
      ],
    ]);
  });

  it('cuts nothing from a line with no length or without a range', () => {
    expect(cutLineByProgress(LINE, []).features).toEqual([]);
    expect(cutLineByProgress([[0, 0]], [[0, 1]]).features).toEqual([]);
    expect(cutLineByProgress(LINE, [[0.4, 0.4]]).features).toEqual([]);
  });
});
