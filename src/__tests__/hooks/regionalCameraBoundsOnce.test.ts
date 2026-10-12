/**
 * Scenario: the opening camera's bounds were recomputed on every `activities`
 * event, and a background sync fires those while the map is open. Each pass
 * walks the whole library three times and bins every centre, to produce a
 * centre that is only ever read while it is the first one.
 *
 * Expected behaviour: the bounds are computed once per mount and the later
 * events cost nothing.
 */

import { act, renderHook } from '@testing-library/react-native';
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
    startPoint: [lat, lng],
  };
}

const BERN = [activity('a1', 46.94, 7.44), activity('a2', 46.95, 7.45)];
const PLUS_ONE = [...BERN, activity('a3', 46.96, 7.46)];

const surface = { fitBounds: jest.fn(), setCamera: jest.fn() };
const commands = () => surface.fitBounds.mock.calls.length + surface.setCamera.mock.calls.length;

function render(initial: ActivityBoundsItem[], cameraRestored = false) {
  return renderHook(
    ({ activities }: { activities: ActivityBoundsItem[] }) => {
      const surfaceRef = useRef(surface);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return useRegionalMapCamera({ activities, surfaceRef, cameraRestored } as any);
    },
    { initialProps: { activities: initial } }
  );
}

const WORLD = [
  {
    ...activity('w1', 0, 0),
    bounds: [
      [-40, -120],
      [60, 120],
    ] as ActivityBoundsItem['bounds'],
  },
];

describe('the regional map opening camera', () => {
  beforeEach(() => clusterSearch.mockClear());

  it('searches for the cluster once, however many sync events land', async () => {
    const { rerender } = await render(BERN);
    const afterMount = clusterSearch.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await rerender({ activities: PLUS_ONE });
    await rerender({ activities: [...PLUS_ONE] });

    expect(clusterSearch).toHaveBeenCalledTimes(afterMount);
  });

  it('still answers a centre for the surface to open on', async () => {
    const { result } = await render(BERN);
    expect(result.current.mapCenter).not.toBeNull();
  });

  /// An empty library at mount has nothing to search, so the first real batch
  /// is what the camera opens on.
  it('computes on the first activities it is given, not on the empty mount', async () => {
    const { result, rerender } = await render([]);
    expect(result.current.mapCenter).toBeNull();

    await rerender({ activities: BERN });
    expect(result.current.mapCenter).not.toBeNull();
  });

  describe('the opening fit', () => {
    beforeEach(() => {
      surface.fitBounds.mockClear();
      surface.setCamera.mockClear();
      jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it('fits once and leaves the camera alone for later syncs', async () => {
      const { result, rerender } = await render(BERN);
      await act(() => result.current.markUserInteracted());
      expect(commands()).toBe(1);

      await rerender({ activities: PLUS_ONE });
      await rerender({ activities: [...PLUS_ONE] });
      expect(commands()).toBe(1);
    });

    it('fits once when activities arrive after the first settle, then stays put', async () => {
      const { result, rerender } = await render([]);
      await act(() => result.current.markUserInteracted());
      expect(commands()).toBe(0);

      await rerender({ activities: BERN });
      expect(commands()).toBe(1);

      await rerender({ activities: PLUS_ONE });
      expect(commands()).toBe(1);
    });

    it('ignores a user pan once the programmatic window has passed', async () => {
      const { result } = await render(BERN);
      await act(() => result.current.markUserInteracted());
      await act(() => {
        jest.advanceTimersByTime(700);
      });
      await act(() => result.current.markUserInteracted());
      expect(commands()).toBe(1);
    });

    it('jumps with one setCamera and no fit for world-spanning data', async () => {
      const { result } = await render(WORLD);
      await act(() => result.current.markUserInteracted());
      expect(surface.setCamera).toHaveBeenCalledTimes(1);
      expect(surface.fitBounds).not.toHaveBeenCalled();
    });

    it('issues no camera command over a restored camera', async () => {
      const { result, rerender } = await render([], true);
      await act(() => result.current.markUserInteracted());
      await rerender({ activities: BERN });
      await rerender({ activities: PLUS_ONE });
      expect(commands()).toBe(0);
    });

    it('issues no camera command when a restored camera settles with activities loaded', async () => {
      const { result } = await render(BERN, true);
      await act(() => result.current.markUserInteracted());
      expect(commands()).toBe(0);
    });
  });
});

describe('the regional map opening camera walk', () => {
  it('reads each activity bounds twice at most: once to find centres, once to bound the cluster', async () => {
    const polyline = require('@/shared/geo/polyline');
    const spy = jest.spyOn(polyline, 'normaliseBounds');
    try {
      await render(PLUS_ONE);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(PLUS_ONE.length * 2);
    } finally {
      spy.mockRestore();
    }
  });
});
