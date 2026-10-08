/**
 * Scenario: the section sheet holds a section's records in a memo keyed on the
 * section, the sport and the time-stream sync. Detection that adds a traversal
 * to the same section announces `sections`, and none of those keys moves, so
 * the sheet kept the records it read at mount.
 *
 * Expected behaviour: the records are read again when the engine announces the
 * sections moved, and not on an unrelated render.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  useSectionPerformances,
  withoutRecordMarks,
  type SectionLap,
  type SectionPerformanceRecord,
} from '@/features/routes/hooks/useSectionPerformances';
import type { FrequentSection } from '@/types';
import { engine, StartOutcome } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      getActivitiesMissingTimeStreams: jest.fn(() => [] as string[]),
      syncTimeStreams: jest.fn(),
      getSectionPerformances: jest.fn(),
      subscribe: jest.fn((event: string, callback: MockListener) => {
        const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
        forEvent.add(callback);
        mockListeners.set(event, forEvent);
        return () => forEvent.delete(callback);
      }),
    },
  })
);

const getSectionPerformances = engine.getSectionPerformances as unknown as jest.Mock;
const missing = engine.getActivitiesMissingTimeStreams as unknown as jest.Mock;
const syncTimeStreams = engine.syncTimeStreams as unknown as jest.Mock;

function performances(activityIds: string[]) {
  return {
    records: activityIds.map((activityId) => ({
      activityId,
      activityName: activityId,
      activityDate: 1_700_000_000,
      laps: [],
      lapCount: 1,
      bestTime: 300,
      bestPace: 4,
      avgTime: 300,
      avgPace: 4,
      direction: 'same',
      sectionDistance: 1200,
    })),
    bestForwardRecord: undefined,
    bestReverseRecord: undefined,
    bestForwardIsPr: false,
    bestReverseIsPr: false,
    forwardStats: undefined,
    reverseStats: undefined,
  };
}

const section = {
  id: 'sec-1',
  activityPortions: [{ activityId: 'a1' }],
} as unknown as FrequentSection;

function fire(event: string) {
  act(() => {
    mockListeners.get(event)?.forEach((listener) => listener());
  });
}

beforeEach(() => {
  mockListeners.clear();
  getSectionPerformances.mockReset();
  getSectionPerformances.mockReturnValue(performances(['a1']));
  missing.mockReturnValue([]);
  syncTimeStreams.mockReturnValue({ outcome: StartOutcome.Started });
});

it('reads the records again when the engine announces the sections moved', async () => {
  const { result } = renderHook(() => useSectionPerformances(section, 'Ride'));
  await waitFor(() => expect(result.current.records).toHaveLength(1));

  getSectionPerformances.mockReturnValue(performances(['a1', 'a2']));
  fire('sections');

  await waitFor(() => expect(result.current.records).toHaveLength(2));
  expect(getSectionPerformances).toHaveBeenLastCalledWith('sec-1', 'Ride');
});

it('does not read again on a render that moved nothing', async () => {
  const { result, rerender } = renderHook(() => useSectionPerformances(section, 'Ride'));
  await waitFor(() => expect(result.current.records).toHaveLength(1));
  const reads = getSectionPerformances.mock.calls.length;

  rerender({});

  expect(getSectionPerformances).toHaveBeenCalledTimes(reads);
});

/// Scenario: offline, one of the section's activities has no stored `time`
/// stream, so the engine reads the records without it and names the best of
/// the rest a PR. The missing outing could be the faster one.
///
/// Expected behaviour: the best is still shown, the PR verdict is held back
/// while a stream is missing, and the count of missing ones is reported.
describe('records read from a partial set', () => {
  const twoActivities = {
    id: 'sec-1',
    activityPortions: [{ activityId: 'a1' }, { activityId: 'a2' }],
  } as unknown as FrequentSection;

  function withPrs() {
    return {
      ...performances(['a1']),
      bestForwardRecord: performances(['a1']).records[0],
      bestForwardIsPr: true,
      bestReverseIsPr: true,
    };
  }

  it('holds back the PR verdict while a stream is missing', async () => {
    missing.mockReturnValue(['a2']);
    syncTimeStreams.mockReturnValue({ outcome: StartOutcome.Held });
    getSectionPerformances.mockReturnValue(withPrs());

    const { result } = renderHook(() => useSectionPerformances(twoActivities, 'Ride'));
    await waitFor(() => expect(result.current.records).toHaveLength(1));

    expect(result.current.outstanding).toBe(1);
    expect(result.current.bestForwardRecord?.activityId).toBe('a1');
    expect(result.current.bestForwardIsPr).toBe(false);
    expect(result.current.bestReverseIsPr).toBe(false);
    expect(result.current.bests).toMatchObject({ forwardIsPr: false, reverseIsPr: false });
  });

  it('passes the PR verdict through once every stream is stored', async () => {
    getSectionPerformances.mockReturnValue(withPrs());

    const { result } = renderHook(() => useSectionPerformances(twoActivities, 'Ride'));
    await waitFor(() => expect(result.current.records).toHaveLength(1));

    expect(result.current.outstanding).toBe(0);
    expect(result.current.bestForwardIsPr).toBe(true);
    expect(result.current.bests).toMatchObject({ forwardIsPr: true, reverseIsPr: true });
  });
});

describe('withoutRecordMarks', () => {
  const lap = (id: string, isRecord: boolean) => ({ id, time: 300, isRecord }) as SectionLap;
  const record = (laps: SectionLap[]) => ({ activityId: 'a1', laps }) as SectionPerformanceRecord;

  it('clears every lap record mark and keeps the laps', () => {
    const read = [record([lap('l1', true), lap('l2', false)]), record([lap('l3', true)])];

    const shown = withoutRecordMarks(read);

    expect(shown.flatMap((r) => r.laps.map((l) => [l.id, l.isRecord]))).toEqual([
      ['l1', false],
      ['l2', false],
      ['l3', false],
    ]);
    expect(read[0]?.laps[0]?.isRecord).toBe(true);
  });

  it('leaves an empty set empty', () => {
    expect(withoutRecordMarks([])).toEqual([]);
  });
});
