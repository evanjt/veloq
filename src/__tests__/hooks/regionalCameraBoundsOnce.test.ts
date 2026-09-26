/**
 * Scenario: the opening camera's bounds were recomputed on every `activities`
 * event, and a background sync fires those while the map is open. Each pass
 * walks the whole library three times and bins every centre, to produce a
 * centre that is only ever read while it is the first one.
 *
 * Expected behaviour: the bounds are computed once per mount and the later
 * events cost nothing.
 */

import { renderHook } from '@testing-library/react-native';
import { useRef } from 'react';

import { useRegionalMapCamera } from '@/features/maps/components/regional/useRegionalMapCamera';
import { densestClusterIndices } from '@/features/maps/lib/densestCluster';
import type { ActivityBoundsItem } from '@/types';

jest.mock('@/features/maps/lib/densestCluster', () => {
  const actual = jest.requireActual('@/features/maps/lib/densestCluster');
  return { ...actual, densestClusterIndices: jest.fn(actual.densestClusterIndices) };
});

const clusterSearch = densestClusterIndices as jest.Mock;

function activity(id: string, lat: number, lng: number): ActivityBoundsItem {
  return {
    id,
    bounds: [
      [lat, lng],
      [lat + 0.01, lng + 0.01],
    ],
    type: 'Ride',
    name: `Ride ${id}`,
    date: '2026-01-15T10:00:00Z',
    distance: 42_000,
    duration: 5400,
    latlngs: [
      [lat, lng],
      [lat + 0.01, lng + 0.01],
    ],
  };
}

const BERN = [activity('a1', 46.94, 7.44), activity('a2', 46.95, 7.45)];
const PLUS_ONE = [...BERN, activity('a3', 46.96, 7.46)];

function render(initial: ActivityBoundsItem[]) {
  return renderHook(
    ({ activities }: { activities: ActivityBoundsItem[] }) => {
      const surfaceRef = useRef(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return useRegionalMapCamera({ activities, surfaceRef } as any);
    },
    { initialProps: { activities: initial } }
  );
}

describe('the regional map opening camera', () => {
  beforeEach(() => clusterSearch.mockClear());

  it('searches for the cluster once, however many sync events land', () => {
    const { rerender } = render(BERN);
    const afterMount = clusterSearch.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    rerender({ activities: PLUS_ONE });
    rerender({ activities: [...PLUS_ONE] });

    expect(clusterSearch).toHaveBeenCalledTimes(afterMount);
  });

  it('still answers a centre for the surface to open on', () => {
    const { result } = render(BERN);
    expect(result.current.mapCenter).not.toBeNull();
  });

  /// An empty library at mount has nothing to search, so the first real batch
  /// is what the camera opens on.
  it('computes on the first activities it is given, not on the empty mount', () => {
    const { result, rerender } = render([]);
    expect(result.current.mapCenter).toBeNull();

    rerender({ activities: BERN });
    expect(result.current.mapCenter).not.toBeNull();
  });
});
