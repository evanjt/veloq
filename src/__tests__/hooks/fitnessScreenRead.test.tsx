/**
 * Scenario: the fitness tab read the eFTP trend once for the chart's badge and
 * again for its markers, and borrowed the summary card's bundle once per sport
 * for the stored critical speeds, though all of it is fixed while the tab is
 * mounted.
 *
 * Expected behaviour: the screen paints all of it from one read, one call on
 * mount and one when activities change, and never reaches for the trend or the
 * summary card on its own.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useFitnessScreenRead } from '@/features/fitness/hooks/useFitnessScreenRead';
import { getEngine } from '@/shared/native/engine';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const listeners = new Map<string, Set<() => void>>();

function emit(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

/** The wall-clock stamp the sync stores: the athlete's local time read as UTC. */
function wallClockStamp(day: string, hour = 12): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour) / 1000;
}

const midnightUtc = (day: string) => wallClockStamp(day, 0);

const pace = (latestPace: number | undefined) => ({ latestPace, sampleCount: 1, history: [] });

function screenRead(over: { changes?: unknown[]; history?: unknown[] } = {}) {
  return {
    ftpTrend: {
      latestFtp: 260,
      previousFtp: 240,
      deltaWatts: 20,
      sampleCount: 3,
      history: over.history ?? [
        { date: midnightUtc('2026-06-01'), value: 240 },
        { date: midnightUtc('2026-09-05'), value: 260 },
      ],
      changes: over.changes ?? [],
    },
    runPaceTrend: pace(3.8),
    swimPaceTrend: pace(1.2),
  };
}

const engine = {
  subscribe: jest.fn((event: string, cb: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(event, set);
    return () => set.delete(cb);
  }),
  getFitnessScreenData: jest.fn(() => screenRead()),
  getFtpTrend: jest.fn(),
  getSummaryCardData: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  engine.getFitnessScreenData.mockImplementation(() => screenRead());
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('the fitness screen read', () => {
  it('serves the trend, the markers and both stored speeds from one call', () => {
    const { result } = renderHook(useFitnessScreenRead);

    expect(result.current.eftpTrend?.latest).toBe(260);
    expect(result.current.eftpTrend?.previous).toBe(240);
    expect(result.current.eftpTrend?.series.map((p) => p.date)).toEqual([
      '2026-06-01',
      '2026-09-05',
    ]);
    expect(result.current.storedRunPace).toBe(3.8);
    expect(result.current.storedSwimPace).toBe(1.2);
    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
    expect(engine.getFtpTrend).not.toHaveBeenCalled();
    expect(engine.getSummaryCardData).not.toHaveBeenCalled();
  });

  it('reads once more when activities change', () => {
    const { result } = renderHook(useFitnessScreenRead);

    engine.getFitnessScreenData.mockImplementation(() => ({
      ...screenRead(),
      runPaceTrend: pace(4.0),
    }));
    emit('activities');

    expect(result.current.storedRunPace).toBe(4.0);
    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(2);
  });

  it('ignores an event the read does not depend on', () => {
    renderHook(useFitnessScreenRead);

    emit('sections');

    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
  });

  it('holds its answer across a render that changes nothing', () => {
    const { result, rerender } = renderHook(useFitnessScreenRead);
    const first = result.current;

    rerender({});

    expect(result.current).toBe(first);
    expect(engine.getFitnessScreenData).toHaveBeenCalledTimes(1);
  });

  it('answers no trend while no day carries an estimate, and no speed when none was stored', () => {
    engine.getFitnessScreenData.mockImplementation(() => ({
      ...screenRead({ history: [] }),
      runPaceTrend: pace(undefined),
      swimPaceTrend: pace(undefined),
    }));

    const { result } = renderHook(useFitnessScreenRead);

    expect(result.current.eftpTrend).toBeUndefined();
    expect(result.current.storedRunPace).toBeNull();
    expect(result.current.storedSwimPace).toBeNull();
  });

  it('answers nothing from a read that throws, and reads again on the next event', () => {
    engine.getFitnessScreenData.mockImplementation(() => {
      throw new Error('engine closed');
    });
    const { result } = renderHook(useFitnessScreenRead);

    expect(result.current.eftpTrend).toBeUndefined();
    expect(result.current.eftpChanges).toEqual([]);
    expect(result.current.storedRunPace).toBeNull();

    engine.getFitnessScreenData.mockImplementation(() => screenRead());
    emit('activities');

    expect(result.current.storedRunPace).toBe(3.8);
  });

  it('answers nothing while the engine is not open', () => {
    (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
      undefined as unknown as ReturnType<typeof getEngine>
    );

    const { result } = renderHook(useFitnessScreenRead);

    expect(result.current.eftpTrend).toBeUndefined();
    expect(result.current.eftpChanges).toEqual([]);
    expect(result.current.storedSwimPace).toBeNull();
  });
});

const change = (day: string, activityId: string, hour = 12) => ({
  activityId,
  date: wallClockStamp(day, hour),
  eftp: 406,
  delta: 20,
  activityName: 'Ride',
});

describe('the eFTP markers', () => {
  it('date each marker by the local day the plot keys on, oldest first', () => {
    engine.getFitnessScreenData.mockImplementation(() =>
      screenRead({ changes: [change('2026-06-06', 'a'), change('2026-07-14', 'b')] })
    );

    const { result } = renderHook(useFitnessScreenRead);

    expect(result.current.eftpChanges.map((c) => [c.activityId, c.date, c.eftp, c.delta])).toEqual([
      ['a', '2026-06-06', 406, 20],
      ['b', '2026-07-14', 406, 20],
    ]);
  });

  describe.each([
    ['Australia/Sydney', 10],
    ['America/Los_Angeles', -7],
  ])('in %s', (_zone, offsetHours) => {
    it('keeps the day of an evening and a morning ride', () => {
      engine.getFitnessScreenData.mockImplementation(() =>
        screenRead({
          changes: [change('2026-07-14', 'evening', 20), change('2026-07-14', 'morning', 6)],
        })
      );

      const { result } = atUtcOffset(offsetHours, () => renderHook(useFitnessScreenRead));

      expect(result.current.eftpChanges.map((c) => [c.activityId, c.date])).toEqual([
        ['evening', '2026-07-14'],
        ['morning', '2026-07-14'],
      ]);
    });
  });
});
