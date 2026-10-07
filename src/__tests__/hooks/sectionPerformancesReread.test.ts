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

import { useSectionPerformances } from '@/features/routes/hooks/useSectionPerformances';
import type { FrequentSection } from '@/types';
import { engine } from 'veloqrs';

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
