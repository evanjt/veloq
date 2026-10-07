/**
 * Scenario: a five-hour ride at 1 Hz reaches 18,000 points, and the live map
 * flipped every one of them from `[lat, lng]` to `[lng, lat]` on every fix,
 * which is quadratic over the ride.
 * Expected behaviour: each recorded point is flipped once, into the same line
 * a whole flip would give.
 */
import {
  emptyGrowingLngLat,
  growLngLat,
  pointsBetweenSourceIndices,
} from '@/features/maps/lib/coordinates';

type Tuple = [number, number];

/** A track whose points count how often their latitude is read. */
function countedTrack(n: number): { track: Tuple[]; reads: () => number } {
  let reads = 0;
  const track = Array.from({ length: n }, (_, i) => {
    const point: Tuple = [46.2 + i * 0.001, 7.3];
    return new Proxy(point, {
      get(target, key, receiver) {
        if (key === '0') reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
  });
  return { track, reads: () => reads };
}

describe('growLngLat', () => {
  it('flips each point once however many fixes arrive', () => {
    const { track, reads } = countedTrack(500);
    const growth = emptyGrowingLngLat();
    for (let length = 1; length <= track.length; length++) growLngLat(growth, track, length);

    expect(reads()).toBe(500);
    expect(growth.points).toHaveLength(500);
    expect(growth.points[0]).toEqual([7.3, 46.2]);
    expect(growth.points[499]).toEqual([7.3, 46.2 + 499 * 0.001]);
  });

  it('keeps the points array as it grows, so a patch can send only the tail', () => {
    const { track } = countedTrack(10);
    const growth = emptyGrowingLngLat();
    const first = growLngLat(growth, track, 5);
    const second = growLngLat(growth, track, 10);

    expect(second).toBe(first);
    expect(second).toHaveLength(10);
  });

  it('drops points that are not finite, as the whole flip does', () => {
    const track: Tuple[] = [
      [46.2, 7.3],
      [NaN, 7.31],
      [46.22, 7.32],
    ];
    const growth = emptyGrowingLngLat();
    growLngLat(growth, track, 2);
    growLngLat(growth, track, 3);

    expect(growth.points).toEqual([
      [7.3, 46.2],
      [7.32, 46.22],
    ]);
  });

  it('starts again when the track shrinks or a new track replaces it', () => {
    const { track } = countedTrack(10);
    const growth = emptyGrowingLngLat();
    const before = growLngLat(growth, track, 10);

    const shorter = growLngLat(growth, track, 4);
    expect(shorter).not.toBe(before);
    expect(shorter).toHaveLength(4);
    expect(shorter[3]).toEqual([7.3, 46.2 + 3 * 0.001]);

    const other: Tuple[] = [
      [47, 8],
      [47.1, 8.1],
    ];
    expect(growLngLat(growth, other, 2)).toEqual([
      [8, 47],
      [8.1, 47.1],
    ]);
  });

  it('leaves out samples with no position and records where each kept point came from', () => {
    const track: Tuple[] = [
      [0, 0],
      [46.2, 7.3],
      [0, 0],
      [46.21, 7.31],
      [46.22, 7.32],
    ];
    const growth = emptyGrowingLngLat();
    growLngLat(growth, track, 2);
    growLngLat(growth, track, 5);

    expect(growth.points).toEqual([
      [7.3, 46.2],
      [7.31, 46.21],
      [7.32, 46.22],
    ]);
    expect(growth.indices).toEqual([1, 3, 4]);
  });

  it('reads a trim range in track indices when placeholders sit before it', () => {
    const track: Tuple[] = [
      [0, 0],
      [46.2, 7.3],
      [0, 0],
      [46.21, 7.31],
      [46.22, 7.32],
    ];
    const growth = emptyGrowingLngLat();
    growLngLat(growth, track, 5);

    expect(pointsBetweenSourceIndices(growth, 3, 4)).toEqual([
      [7.31, 46.21],
      [7.32, 46.22],
    ]);
    expect(pointsBetweenSourceIndices(growth, 0, 1)).toEqual([[7.3, 46.2]]);
    expect(pointsBetweenSourceIndices(growth, 2, 2)).toEqual([]);
  });
});
