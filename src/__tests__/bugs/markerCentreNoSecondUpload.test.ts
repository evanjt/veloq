/**
 * Scenario: the map page placed every marker on its activity's bounding box
 * centre, then moved all of them once the route signatures finished loading,
 * because the signatures load runs after interactions. Two full uploads of N
 * points and two Supercluster index builds per map mount.
 *
 * Expected behaviour: the start point arrives with the map screen read, so the
 * marker goes where it belongs on the first upload. The bounding box centre is
 * what is left for an activity the engine holds no signature for.
 */

import { startCenterFor } from '@/features/maps/lib/markerCentre';
import type { ActivityBoundsItem } from '@/types';

function activity(overrides: Partial<ActivityBoundsItem> = {}): ActivityBoundsItem {
  return {
    id: 'a1',
    // A box running due east, so the centre longitude is not the start's.
    bounds: [
      [46.2, 7.35],
      [46.2, 7.36],
    ],
    type: 'Ride' as ActivityBoundsItem['type'],
    name: 'Morning Ride',
    date: '2026-09-01T06:00:00.000Z',
    distance: 30_000,
    duration: 3_600,
    ...overrides,
  };
}

describe('where a map marker sits', () => {
  it('is the start point the engine gave, in GeoJSON lng/lat order', () => {
    expect(startCenterFor(activity({ startPoint: [46.2, 7.35] }))).toEqual([7.35, 46.2]);
  });

  it('is not the bounding box centre when a start point is known', () => {
    const withStart = activity({ startPoint: [46.2, 7.35] });
    expect(startCenterFor(withStart)).not.toEqual(startCenterFor(activity()));
  });

  it('falls back to the cached track when the engine holds no signature', () => {
    expect(
      startCenterFor(
        activity({
          latlngs: [
            [46.21, 7.4],
            [46.22, 7.41],
          ],
        })
      )
    ).toEqual([7.4, 46.21]);
  });

  it('prefers the engine start over a cached track, the engine being the record', () => {
    expect(
      startCenterFor(
        activity({
          startPoint: [46.2, 7.35],
          latlngs: [[1, 2]],
        })
      )
    ).toEqual([7.35, 46.2]);
  });

  it('falls back to the bounding box centre with neither', () => {
    expect(startCenterFor(activity())).toEqual([7.355, 46.2]);
  });

  it('ignores a start point carrying a non-finite coordinate', () => {
    expect(startCenterFor(activity({ startPoint: [Number.NaN, 7.35] }))).toEqual([7.355, 46.2]);
    expect(startCenterFor(activity({ startPoint: [46.2, Number.POSITIVE_INFINITY] }))).toEqual([
      7.355, 46.2,
    ]);
  });

  it('ignores a cached first point carrying a non-finite coordinate', () => {
    expect(startCenterFor(activity({ latlngs: [[Number.NaN, 7.4]] }))).toEqual([7.355, 46.2]);
  });

  it('returns a finite pair for every shape, which is what the iOS marker upload needs', () => {
    const shapes: Partial<ActivityBoundsItem>[] = [
      {},
      { startPoint: [46.2, 7.35] },
      { latlngs: [[46.21, 7.4]] },
      { latlngs: [] },
      { startPoint: [Number.NaN, Number.NaN], latlngs: [] },
    ];
    for (const shape of shapes) {
      const [lng, lat] = startCenterFor(activity(shape));
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });
});
