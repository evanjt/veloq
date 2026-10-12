/**
 * Scenario: the demo GPS fetch stores a batch of tracks in the engine.
 *
 * Expected behaviour: the fetch hands the engine the tracks and refreshes the
 * activity list, and writes no `activity_metrics` row itself: the bodies the
 * demo seed stored already carry theirs.
 */
import { renderHook } from '@testing-library/react-native';

import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';

const mockAddActivities = jest.fn(async () => undefined);

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      setTimeStreams: jest.fn(),
      triggerRefresh: jest.fn(),
    },
  })
);
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({
    engine: {
      addActivities: (...args: unknown[]) => mockAddActivities(...(args as [])),
      getSectionDetectionProgress: () => null,
    },
  }),
  getEngine: () => null,
}));
jest.mock('@/data/demo/fixtures', () => ({
  getActivityMap: () => ({
    latlngs: [
      [46.5, 6.6],
      [46.51, 6.61],
      [46.52, 6.62],
      [46.53, 6.63],
    ],
  }),
  getActivityStreams: () => null,
}));
jest.mock('@/features/routes/lib/tilePass', () => ({
  awaitTilePass: jest.fn(async () => undefined),
}));

const { engine } = require('veloqrs');

const activity = (id: string) => ({ activityId: id, sportType: 'Ride' });

describe('the demo GPS fetch', () => {
  it('writes no metrics row from TypeScript and still refreshes the lists', async () => {
    const { result } = await renderHook(() => useGpsDataFetcher());

    const outcome = await result.current.fetchDemoGps([activity('d1'), activity('d2')], {
      isMountedRef: { current: true },
      abortSignal: new AbortController().signal,
      updateProgress: jest.fn(),
    });

    expect(outcome.syncedIds).toEqual(['d1', 'd2']);
    expect(mockAddActivities).toHaveBeenCalledTimes(1);
    expect(engine.triggerRefresh).toHaveBeenCalledWith('activities');
  });
});
