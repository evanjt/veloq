/**
 * Scenario: the sync could not ready an activity, so the detail read carries
 * the fault, and a later clean readying clears it.
 *
 * Expected behaviour: the bundle holds the fault the engine reported, holds
 * null when the engine reports none, and re-reads when the activity's bodies
 * land so the mark goes once the retry has worked.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useActivityDetailData } from '@/features/activity/hooks/useActivityDetailData';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

type Listener = (payload?: unknown) => void;

function engineReporting(failure: () => { message: string; failedAt: number } | undefined) {
  const listeners: Record<string, Set<Listener>> = {};
  const engine = {
    subscribe: (event: string, listener: Listener) => {
      (listeners[event] ??= new Set()).add(listener);
      return () => listeners[event]?.delete(listener);
    },
    getActivityDetailData: jest.fn(() => ({
      activityCount: 1,
      sectionCount: 0,
      routeGroups: [],
      matchedSections: [],
      customSections: [],
      encounters: [],
      highlights: { indicators: [], routeHighlights: [], newGround: [], strengthCards: [] },
      sectionTraces: [],
      prSectionIds: [],
      hrZones: [],
      ledgerChanges: [],
      syncFailure: failure(),
    })),
  };
  const emit = (event: string, payload?: unknown) =>
    act(() => listeners[event]?.forEach((listener) => listener(payload)));
  return { engine, emit };
}

afterEach(() => mockGetEngine.mockReset());

it('carries the fault the engine reported against the activity', async () => {
  const { engine } = engineReporting(() => ({ message: 'streams did not decode', failedAt: 5 }));
  mockGetEngine.mockReturnValue(engine);

  const { result } = await renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.syncFailure).toEqual({
    message: 'streams did not decode',
    failedAt: 5,
  });
});

it('holds null when the engine reports no fault', async () => {
  const { engine } = engineReporting(() => undefined);
  mockGetEngine.mockReturnValue(engine);

  const { result } = await renderHook(() => useActivityDetailData('a1'));

  expect(result.current.data?.syncFailure).toBeNull();
});

it('drops the fault once the retried streams body lands', async () => {
  let failure: { message: string; failedAt: number } | undefined = {
    message: 'streams did not decode',
    failedAt: 5,
  };
  const { engine, emit } = engineReporting(() => failure);
  mockGetEngine.mockReturnValue(engine);
  const { result } = await renderHook(() => useActivityDetailData('a1'));
  expect(result.current.data?.syncFailure).not.toBeNull();

  failure = undefined;
  await emit('bodyStored', { kind: 'streams', activityId: 'a1' });

  expect(result.current.data?.syncFailure).toBeNull();
});
