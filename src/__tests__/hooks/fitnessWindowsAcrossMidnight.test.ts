/**
 * Scenario: the fitness tab is left open on its page past local midnight, with
 * nothing synced. The activity strip and the zone cards measure their windows
 * from the clock, and their reads are keyed only on the engine's `activities`
 * event, which does not fire.
 *
 * Expected behaviour: the window ends on the new local day, and each hook reads
 * again once the day has turned, with no event needed. Within one day a re-render
 * reads nothing new.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useDailyActivityLoads } from '@/features/fitness/hooks/useDailyActivityLoads';
import { useZoneDistribution } from '@/features/fitness/hooks/useZoneDistribution';
import { localDay } from '../__shared__/clockEdges';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const getDailyActivityLoads = jest.fn(() => []);
const getZoneDistribution = jest.fn(() => ({
  seconds: [600, 300, 100, 0, 0, 0, 0],
  shares: [60, 30, 10, 0, 0, 0, 0],
  names: [],
}));

const engine = {
  subscribe: jest.fn(() => () => undefined),
  getDailyActivityLoads,
  getZoneDistribution,
};

const beforeMidnight = new Date(2026, 8, 26, 23, 30);
const afterMidnight = new Date(2026, 8, 27, 0, 30);
const laterSameDay = new Date(2026, 8, 27, 9, 0);

/** The UTC stamp a local wall-clock day boundary is stored as. */
const stampAt = (day: string, time: string) => Date.parse(`${day}T${time}Z`) / 1000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(beforeMidnight);
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the daily activity loads across local midnight', () => {
  it('ends the window on the new day once the clock passes midnight', async () => {
    const { rerender } = await renderHook(() => useDailyActivityLoads(7));
    const [, endBefore] = getDailyActivityLoads.mock.calls.at(-1) as unknown as number[];
    expect(endBefore).toBe(stampAt(localDay(beforeMidnight), '23:59:59'));

    act(() => jest.setSystemTime(afterMidnight));
    await rerender({});

    const [startAfter, endAfter] = getDailyActivityLoads.mock.calls.at(-1) as unknown as number[];
    expect(endAfter).toBe(stampAt(localDay(afterMidnight), '23:59:59'));
    expect(startAfter).toBe(stampAt(localDay(afterMidnight, -7), '00:00:00'));
  });

  it('reads nothing more on a re-render within the same day', async () => {
    const { rerender } = await renderHook(() => useDailyActivityLoads(7));
    act(() => jest.setSystemTime(afterMidnight));
    await rerender({});
    const afterTurn = getDailyActivityLoads.mock.calls.length;

    act(() => jest.setSystemTime(laterSameDay));
    await rerender({});

    expect(getDailyActivityLoads.mock.calls.length).toBe(afterTurn);
  });
});

describe('the zone distribution across local midnight', () => {
  it('ends the trailing window on the new day once the clock passes midnight', async () => {
    const { rerender } = await renderHook(() =>
      useZoneDistribution({ type: 'hr', sport: 'Cycling', days: 7 })
    );
    const [, , startBefore, endBefore] = getZoneDistribution.mock.calls.at(-1) as unknown as [
      string,
      string,
      number,
      number,
    ];
    expect(endBefore).toBe(stampAt(localDay(beforeMidnight), '23:59:59'));
    expect(startBefore).toBe(stampAt(localDay(beforeMidnight, -7), '00:00:00'));

    act(() => jest.setSystemTime(afterMidnight));
    await rerender({});

    const [, , startAfter, endAfter] = getZoneDistribution.mock.calls.at(-1) as unknown as [
      string,
      string,
      number,
      number,
    ];
    expect(endAfter).toBe(stampAt(localDay(afterMidnight), '23:59:59'));
    expect(startAfter).toBe(stampAt(localDay(afterMidnight, -7), '00:00:00'));
  });
});
