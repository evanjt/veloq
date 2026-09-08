/**
 * Scenario: the jobs screen is the app's standing answer to what is running.
 *
 * Expected behaviour: every job has a row on every render, a job that has never
 * run in this process reads as idle rather than disappearing, and a resting
 * elevation backfill still reports the queue behind it.
 */

import { act, renderHook } from '@testing-library/react-native';
import { SyncState } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useBackgroundJobs } from '@/features/settings/hooks/useBackgroundJobs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface EngineState {
  sync: {
    state: SyncState;
    inFlight: number;
    completed: number;
    total: number;
    lastError?: string;
  };
  detection: string;
  lastOutcome: string;
  detectionProgress: { phase: string; completed: number; total: number; percent: number } | null;
  backfill: { phase: string; completed: number; total: number; failed: number } | null;
  remaining: number | null;
  cutover: { phase: string; running: boolean } | null;
  cutoverPending: boolean;
}

function defaultState(): EngineState {
  return {
    sync: { state: SyncState.Idle, inFlight: 0, completed: 0, total: 0 },
    detection: 'idle',
    lastOutcome: 'idle',
    detectionProgress: null,
    backfill: { phase: 'idle', completed: 0, total: 0, failed: 0 },
    remaining: null,
    cutover: { phase: 'idle', running: false },
    cutoverPending: false,
  };
}

let state: EngineState;
/** Every taking read of the completion, which a status surface must not make. */
let polls = 0;
const listeners = new Map<string, Set<() => void>>();

function engine() {
  return {
    getSyncStatus: () => state.sync,
    pollSectionDetection: () => {
      polls += 1;
      return state.detection;
    },
    lastSectionDetectionOutcome: () => state.lastOutcome,
    getSectionDetectionProgress: () => state.detectionProgress,
    getElevationBackfillProgress: () => state.backfill,
    getElevationBackfillRemaining: () => state.remaining,
    getCutoverProgress: () => state.cutover,
    isCutoverPending: () => state.cutoverPending,
    getCutoverDiff: () => null,
    subscribe: (event: string, callback: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(callback);
      listeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

/** Stands in for the timer the detection poll runs on. */
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function jobs() {
  return renderHook(() => useBackgroundJobs());
}

describe('useBackgroundJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    listeners.clear();
    polls = 0;
    state = defaultState();
    mockGetEngine.mockImplementation(() => engine());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists every job on an engine where nothing has ever run', () => {
    const { result } = jobs();

    expect(result.current.map((job) => job.id)).toEqual([
      'sync',
      'detection',
      'elevationBackfill',
      'cutover',
    ]);
    expect(result.current.every((job) => job.state === 'idle')).toBe(true);
  });

  it('keeps all four rows when there is no engine at all', () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = jobs();

    expect(result.current).toHaveLength(4);
    expect(result.current.every((job) => job.state === 'idle')).toBe(true);
    expect(result.current.every((job) => job.remaining === null)).toBe(true);
  });

  it('reports the queue behind a backfill that is not running', () => {
    state.remaining = 42;

    const { result } = jobs();

    const backfill = result.current.find((job) => job.id === 'elevationBackfill');
    expect(backfill?.state).toBe('idle');
    expect(backfill?.remaining).toBe(42);
  });

  it('leaves the queue null when the engine cannot count it', () => {
    state.remaining = null;

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.remaining).toBeNull();
  });

  it('picks up a detection run that started before the screen opened', () => {
    state.detection = 'running';
    state.detectionProgress = { phase: 'clustering', completed: 3, total: 9, percent: 40 };

    const { result } = jobs();

    const detection = result.current.find((job) => job.id === 'detection');
    expect(detection?.state).toBe('running');
    expect(detection?.phase).toBe('clustering');
    expect(detection?.percent).toBe(40);
  });

  it('picks up a detection run that starts while the screen is open', () => {
    const { result } = jobs();
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('idle');

    state.detection = 'running';
    state.detectionProgress = { phase: 'loading', completed: 1, total: 4, percent: 10 };
    advance(1000);

    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('running');
  });

  it('reads a detection that aborted as failed, not as one that finished', () => {
    const { result } = jobs();

    state.lastOutcome = 'error';
    advance(1000);

    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('failed');
  });

  /**
   * The completion is a taking read: whichever caller polls it first applies
   * the run and every other caller then sees idle. A status screen that takes
   * it settles a run the follower is still waiting on, and the rescan it
   * belongs to reports no change.
   */
  it('never takes the completion, whatever it is showing', () => {
    const { result } = jobs();

    state.detectionProgress = { phase: 'loading', completed: 1, total: 4, percent: 10 };
    advance(1000);
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('running');

    state.detectionProgress = null;
    state.lastOutcome = 'complete';
    advance(1000);
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('complete');

    advance(5000);
    expect(polls).toBe(0);
  });

  it('stops reading detection once the screen is gone', () => {
    let reads = 0;
    mockGetEngine.mockImplementation(() => {
      const real = engine() as unknown as Record<string, unknown>;
      return {
        ...real,
        getSectionDetectionProgress: () => {
          reads += 1;
          return state.detectionProgress;
        },
      } as unknown as ReturnType<typeof getEngine>;
    });

    const { unmount } = jobs();
    advance(3000);
    const whileMounted = reads;
    unmount();
    advance(5000);

    expect(whileMounted).toBeGreaterThan(1);
    expect(reads).toBe(whileMounted);
  });

  it('reads an expired credential as a failed sync', () => {
    state.sync = { state: SyncState.AuthExpired, inFlight: 0, completed: 0, total: 0 };

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'sync')?.state).toBe('failed');
  });

  it('reads a settled sync that left an error as failed', () => {
    state.sync = {
      state: SyncState.Idle,
      inFlight: 0,
      completed: 3,
      total: 3,
      lastError: 'timeout',
    };

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'sync')?.state).toBe('failed');
  });

  it('carries a running sync count', () => {
    state.sync = { state: SyncState.Syncing, inFlight: 2, completed: 5, total: 20 };

    const { result } = jobs();

    const sync = result.current.find((job) => job.id === 'sync');
    expect(sync?.state).toBe('running');
    expect(sync?.completed).toBe(5);
    expect(sync?.total).toBe(20);
  });

  it('keeps a partial backfill distinct from a complete one', () => {
    state.backfill = { phase: 'partial', completed: 8, total: 10, failed: 2 };

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.state).toBe('partial');
  });

  it('reads a paused backfill as paused, not as idle with work waiting', () => {
    state.backfill = { phase: 'paused', completed: 20, total: 40, failed: 0 };
    state.remaining = 20;

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.state).toBe('paused');
  });

  it('reads a cutover mid-run as running whatever phase it holds', () => {
    state.cutover = { phase: 'archiving', running: true };

    const { result } = jobs();

    const cutover = result.current.find((job) => job.id === 'cutover');
    expect(cutover?.state).toBe('running');
    expect(cutover?.phase).toBe('archiving');
  });

  it('reads a cutover that failed as failed', () => {
    state.cutover = { phase: 'failed', running: false };

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.state).toBe('failed');
  });

  it('reads idle from a detection poll that throws rather than losing the screen', () => {
    mockGetEngine.mockImplementation(
      () =>
        ({
          ...(engine() as unknown as Record<string, unknown>),
          pollSectionDetection: () => {
            throw new Error('poisoned');
          },
        }) as unknown as ReturnType<typeof getEngine>
    );

    const { result } = jobs();

    expect(result.current).toHaveLength(4);
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('idle');
  });

  /**
   * Scenario: the phases the engine keeps are process-global and start at idle
   * on every launch, so a relaunch with a cutover still owed showed the row as
   * having nothing to report. The token behind it is durable and was already
   * exported; the screen simply did not ask.
   *
   * Expected behaviour: a resting cutover row says the work is waiting.
   */
  it('rests with the cutover it still owes, on a launch where nothing has run', () => {
    state.cutoverPending = true;

    const { result } = jobs();
    const cutover = result.current.find((job) => job.id === 'cutover');

    expect(cutover?.state).toBe('idle');
    expect(cutover?.remaining).toBe(1);
  });

  it('rests with nothing owed when the token is clear', () => {
    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBe(0);
  });

  it('reports no count rather than zero when the engine cannot answer', () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBeNull();
  });

  it('does not claim a running cutover is also waiting', () => {
    state.cutoverPending = true;
    state.cutover = { phase: 'archiving', running: true };

    const { result } = jobs();
    const cutover = result.current.find((job) => job.id === 'cutover');

    expect(cutover?.state).toBe('running');
    expect(cutover?.remaining).toBeNull();
  });

  it('survives a throwing pending read rather than losing the row', () => {
    mockGetEngine.mockImplementation(
      () =>
        ({
          ...engine(),
          isCutoverPending: () => {
            throw new Error('engine gone');
          },
        }) as unknown as ReturnType<typeof getEngine>
    );

    const { result } = jobs();

    expect(result.current).toHaveLength(4);
    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBeNull();
  });
});
