/**
 * Scenario: the settings hub shows one word about background jobs, "2 running"
 * or "Idle", and it used the jobs screen's own hook to get it.
 *
 * Expected behaviour: the hub's count costs one cheap read a tick. The jobs
 * screen's hook also asks for the awaiting count, a COUNT under the engine's
 * write lock, which a one-word subtitle has no use for and which stalls the
 * hub's JS thread for as long as a sync write holds the lock.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useRunningJobCount } from '@/features/settings/hooks/useBackgroundJobs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface EngineState {
  detectionProgress: { phase: string; completed: number; total: number; percent: number } | null;
  backfill: { phase: string; completed: number; total: number; failed: number } | null;
  cutover: { phase: string; running: boolean } | null;
}

let state: EngineState;
const calls: string[] = [];

function engine() {
  const record = <T>(name: string, value: () => T) => {
    calls.push(name);
    return value();
  };
  return {
    getSectionDetectionProgress: () =>
      record('getSectionDetectionProgress', () => state.detectionProgress),
    sectionDetectionAwaiting: () => record('sectionDetectionAwaiting', () => 0),
    lastSectionDetectionOutcome: () => record('lastSectionDetectionOutcome', () => 'idle'),
    getElevationBackfillProgress: () =>
      record('getElevationBackfillProgress', () => state.backfill),
    getElevationBackfillRemaining: () => record('getElevationBackfillRemaining', () => null),
    isElevationBackfillPaused: () => false,
    getCutoverProgress: () => record('getCutoverProgress', () => state.cutover),
    getCutoverDiff: () => record('getCutoverDiff', () => null),
    isCutoverPending: () => record('isCutoverPending', () => false),
    subscribe: () => () => {},
  } as unknown as ReturnType<typeof getEngine>;
}

beforeEach(() => {
  jest.useFakeTimers();
  calls.length = 0;
  state = {
    detectionProgress: null,
    backfill: { phase: 'idle', completed: 0, total: 0, failed: 0 },
    cutover: { phase: 'idle', running: false },
  };
  mockGetEngine.mockImplementation(engine);
});

afterEach(() => {
  jest.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useRunningJobCount', () => {
  it('never asks for the awaiting count', () => {
    renderHook(() => useRunningJobCount());
    advance(5000);

    expect(calls).not.toContain('sectionDetectionAwaiting');
  });

  it('never asks how the last detection run ended', () => {
    renderHook(() => useRunningJobCount());
    advance(5000);

    expect(calls).not.toContain('lastSectionDetectionOutcome');
  });

  it('spends one read a tick while everything is idle', () => {
    renderHook(() => useRunningJobCount());
    calls.length = 0;

    advance(3000);

    expect(calls).toEqual([
      'getSectionDetectionProgress',
      'getSectionDetectionProgress',
      'getSectionDetectionProgress',
    ]);
  });

  it('counts a detection run the poll picks up', () => {
    const { result } = renderHook(() => useRunningJobCount());
    expect(result.current).toBe(0);

    state.detectionProgress = { phase: 'matching', completed: 3, total: 9, percent: 33 };
    advance(1000);

    expect(result.current).toBe(1);
  });

  // Expected behaviour: a tick that finds nothing changed does not re-render
  // the screen. The hub reads the last-backup setting in its render body, so a
  // re-render a second is an extra FFI call a second for a date that has not
  // moved.
  it('does not re-render while the answer stays the same', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useRunningJobCount();
    });
    const atMount = renders;

    advance(5000);

    expect(renders).toBe(atMount);
  });

  it('counts the backfill and the cutover alongside detection', () => {
    state.detectionProgress = { phase: 'matching', completed: 3, total: 9, percent: 33 };
    state.backfill = { phase: 'fetching', completed: 1, total: 4, failed: 0 };
    state.cutover = { phase: 'rebuilding', running: true };

    const { result } = renderHook(() => useRunningJobCount());

    expect(result.current).toBe(3);
  });
});
