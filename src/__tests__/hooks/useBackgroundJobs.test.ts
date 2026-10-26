/**
 * Scenario: the jobs screen is the app's standing answer to what is running.
 *
 * Expected behaviour: every job has a row on every render, a job that has never
 * run in this process reads as idle rather than disappearing, and a resting
 * elevation backfill still reports the queue behind it.
 */

import { act, renderHook } from '@testing-library/react-native';

import { routesStatus } from '../__shared__/routesStatusStub';
import { SyncState } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useBackgroundJobs } from '@/features/settings/hooks/useBackgroundJobs';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

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
  backfill: {
    phase: string;
    completed: number;
    total: number;
    failed: number;
    resumesAt?: number | null;
  } | null;
  remaining: number | null;
  cutover: { phase: string; running: boolean } | null;
  cutoverPending: boolean;
  detectionAwaiting: number | null;
  stream: { phase: string; completed: number; total: number; resumesAt?: number | null } | null;
  streamRemaining: number | null;
  streamDaysToFinish: number | null;
  passRecountRunning: boolean;
  runs: Record<string, unknown>[];
  dataThrows: string | null;
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
    detectionAwaiting: 0,
    stream: null,
    streamRemaining: null,
    streamDaysToFinish: null,
    passRecountRunning: false,
    runs: [],
    dataThrows: null,
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
    getSectionDetectionProgress: () => state.detectionProgress,
    getRoutesStatusData: () =>
      routesStatus({
        detection: state.detectionProgress,
        detectionOutcome: state.lastOutcome,
        elevation: state.backfill,
        elevationRemaining: state.remaining,
        cutover: state.cutover,
        stream: state.stream,
        streamRemaining: state.streamRemaining,
      }),
    getBackgroundJobsData: () => {
      if (state.dataThrows) throw new Error(state.dataThrows);
      return {
        runs: state.runs,
        passRecountRunning: state.passRecountRunning,
        detectionAwaiting: state.detectionAwaiting ?? undefined,
        cutoverOwed: state.cutoverPending,
        streamDaysToFinish: state.streamDaysToFinish ?? undefined,
      };
    },
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
async function advance(ms: number) {
  await act(() => {
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

  it('lists every job on an engine where nothing has ever run', async () => {
    const { result } = await jobs();

    // No sync row. Every other row rests on a count of what it still owes, and
    // sync is scheduled rather than owed, so it had none to rest on.
    expect(result.current.map((job) => job.id)).toEqual([
      'detection',
      'elevationBackfill',
      'cutover',
      'streamBackfill',
      'passRecount',
    ]);
    expect(result.current.every((job) => job.state === 'idle')).toBe(true);
  });

  it('reads one routes snapshot for all jobs when the bar mounts', async () => {
    let reads = 0;
    mockGetEngine.mockImplementation(() => {
      const base = engine() as unknown as Record<string, unknown>;
      const read = base.getRoutesStatusData as () => unknown;
      return {
        ...base,
        getRoutesStatusData: () => {
          reads += 1;
          return read();
        },
      } as unknown as ReturnType<typeof getEngine>;
    });

    const { result } = await jobs();
    expect(result.current).toHaveLength(5);
    expect(reads).toBe(1);
    await advance(1500);
    expect(reads).toBe(4);
  });

  it('keeps every row when there is no engine at all', async () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = await jobs();

    expect(result.current).toHaveLength(5);
    expect(result.current.every((job) => job.state === 'idle')).toBe(true);
    expect(result.current.every((job) => job.remaining === null)).toBe(true);
  });

  it('reports the queue behind a backfill that is not running', async () => {
    state.remaining = 42;

    const { result } = await jobs();

    const backfill = result.current.find((job) => job.id === 'elevationBackfill');
    expect(backfill?.state).toBe('idle');
    expect(backfill?.remaining).toBe(42);
  });

  it('leaves the queue null when the engine cannot count it', async () => {
    state.remaining = null;

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.remaining).toBeNull();
  });

  it('picks up a detection run that started before the screen opened', async () => {
    state.detection = 'running';
    state.detectionProgress = { phase: 'analyzing', completed: 3, total: 9, percent: 40 };

    const { result } = await jobs();

    const detection = result.current.find((job) => job.id === 'detection');
    expect(detection?.state).toBe('running');
    expect(detection?.phase).toBe('analyzing');
    expect(detection?.percent).toBe(40);
  });

  it('picks up a detection run that starts while the screen is open', async () => {
    const { result } = await jobs();
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('idle');

    state.detection = 'running';
    state.detectionProgress = { phase: 'loading', completed: 1, total: 4, percent: 10 };
    await advance(1000);

    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('running');
  });

  it('reads a detection that aborted as failed, not as one that finished', async () => {
    const { result } = await jobs();

    state.lastOutcome = 'error';
    await advance(1000);

    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('failed');
  });

  /**
   * The completion is a taking read: whichever caller polls it first applies
   * the run and every other caller then sees idle. A status screen that takes
   * it settles a run the follower is still waiting on, and the rescan it
   * belongs to reports no change.
   */
  it('never takes the completion, whatever it is showing', async () => {
    const { result } = await jobs();

    state.detectionProgress = { phase: 'loading', completed: 1, total: 4, percent: 10 };
    await advance(1000);
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('running');

    state.detectionProgress = null;
    state.lastOutcome = 'complete';
    await advance(1000);
    expect(result.current.find((job) => job.id === 'detection')?.state).toBe('complete');

    await advance(5000);
    expect(polls).toBe(0);
  });

  it('stops reading detection once the screen is gone', async () => {
    let reads = 0;
    mockGetEngine.mockImplementation(() => {
      const real = engine() as unknown as Record<string, unknown>;
      return {
        ...real,
        getRoutesStatusData: () => {
          reads += 1;
          return routesStatus({
            detection: state.detectionProgress,
            detectionOutcome: state.lastOutcome,
            elevation: state.backfill,
            elevationRemaining: state.remaining,
            cutover: state.cutover,
            stream: state.stream,
            streamRemaining: state.streamRemaining,
          });
        },
      } as unknown as ReturnType<typeof getEngine>;
    });

    const { unmount } = await jobs();
    await advance(3000);
    const whileMounted = reads;
    await unmount();
    await advance(5000);

    expect(whileMounted).toBeGreaterThan(1);
    expect(reads).toBe(whileMounted);
  });

  it('carries no sync row at all, whatever the sync service says', async () => {
    state.sync = { state: SyncState.Syncing, inFlight: 2, completed: 5, total: 20 };

    const { result } = await jobs();

    // A running sync is reported by the sync notification and the feed's own
    // banner. This screen lists what is owed, and sync owes nothing countable.
    expect(result.current.find((job) => (job.id as string) === 'sync')).toBeUndefined();
  });

  it('keeps a partial backfill distinct from a complete one', async () => {
    state.backfill = { phase: 'partial', completed: 8, total: 10, failed: 2 };

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.state).toBe('partial');
  });

  it('reads a paused backfill as paused, not as idle with work waiting', async () => {
    state.backfill = { phase: 'paused', completed: 20, total: 40, failed: 0 };
    state.remaining = 20;

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'elevationBackfill')?.state).toBe('paused');
  });

  it('lists a running pass recount as a running row', async () => {
    state.passRecountRunning = true;

    const { result } = await jobs();

    const recount = result.current.find((job) => job.id === 'passRecount');
    expect(recount?.state).toBe('running');
    expect(recount?.lastRun).toBeNull();
  });

  it('shows a settled pass recount as idle with its last run', async () => {
    state.runs = [
      {
        job: 'passRecount',
        finishedAt: 1_791_000_000_000,
        outcome: 'complete',
        handled: 42,
        added: 0,
        changed: 42,
        retired: 0,
        failed: 0,
      },
    ];

    const { result } = await jobs();

    const recount = result.current.find((job) => job.id === 'passRecount');
    expect(recount?.state).toBe('idle');
    expect(recount?.lastRun?.handled).toBe(42);
  });

  it('reads a cutover mid-run as running whatever phase it holds', async () => {
    state.cutover = { phase: 'archiving', running: true };

    const { result } = await jobs();

    const cutover = result.current.find((job) => job.id === 'cutover');
    expect(cutover?.state).toBe('running');
    expect(cutover?.phase).toBe('archiving');
  });

  it('reads a cutover that failed as failed', async () => {
    state.cutover = { phase: 'failed', running: false };

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.state).toBe('failed');
  });

  it('reads a cutover that failed after its apply as failed', async () => {
    state.cutover = { phase: 'failed_after_apply', running: false };

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.state).toBe('failed');
  });

  it('reads idle from a detection poll that throws rather than losing the screen', async () => {
    mockGetEngine.mockImplementation(
      () =>
        ({
          ...(engine() as unknown as Record<string, unknown>),
          pollSectionDetection: () => {
            throw new Error('poisoned');
          },
        }) as unknown as ReturnType<typeof getEngine>
    );

    const { result } = await jobs();

    expect(result.current).toHaveLength(5);
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
  it('rests with the cutover it still owes, on a launch where nothing has run', async () => {
    state.cutoverPending = true;

    const { result } = await jobs();
    const cutover = result.current.find((job) => job.id === 'cutover');

    expect(cutover?.state).toBe('idle');
    expect(cutover?.remaining).toBe(1);
  });

  it('rests with nothing owed when the token is clear', async () => {
    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBe(0);
  });

  it('reports no count rather than zero when the engine cannot answer', async () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBeNull();
  });

  it('does not claim a running cutover is also waiting', async () => {
    state.cutoverPending = true;
    state.cutover = { phase: 'archiving', running: true };

    const { result } = await jobs();
    const cutover = result.current.find((job) => job.id === 'cutover');

    expect(cutover?.state).toBe('running');
    expect(cutover?.remaining).toBeNull();
  });

  it('survives a throwing screen read rather than losing the rows', async () => {
    state.dataThrows = 'engine gone';

    const { result } = await jobs();

    expect(result.current).toHaveLength(5);
    expect(result.current.find((job) => job.id === 'cutover')?.remaining).toBeNull();
    expect(result.current.find((job) => job.id === 'detection')?.remaining).toBeNull();
  });

  /**
   * Detection's phase is process-global and starts at idle, so a relaunch with
   * activities never detected showed the row reporting nothing. The processed
   * set behind it is persisted, and what is not in it is what a run owes.
   */
  it('rests with the activities detection has never seen', async () => {
    state.detectionAwaiting = 12;

    const { result } = await jobs();
    const detection = result.current.find((job) => job.id === 'detection');

    expect(detection?.state).toBe('idle');
    expect(detection?.remaining).toBe(12);
  });

  it('rests with nothing owed once every activity has been through a detect', async () => {
    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'detection')?.remaining).toBe(0);
  });

  it('does not claim a running detect is also waiting', async () => {
    state.detectionAwaiting = 12;
    state.detectionProgress = { phase: 'analyzing', completed: 3, total: 12, percent: 25 };

    const { result } = await jobs();
    const detection = result.current.find((job) => job.id === 'detection');

    expect(detection?.state).toBe('running');
    expect(detection?.remaining).toBeNull();
  });

  it('rests with the activities still owed a stream, on a launch where nothing has run', async () => {
    state.streamRemaining = 300;

    const { result } = await jobs();
    const stream = result.current.find((job) => job.id === 'streamBackfill');

    expect(stream?.state).toBe('idle');
    expect(stream?.remaining).toBe(300);
  });

  /**
   * Scenario: the library owes more streams than one day's allowance draws, and
   * the engine's read says how many days that takes.
   *
   * Expected behaviour: the stream row carries the engine's day figure, and a
   * row whose queue the engine did not price carries none.
   */
  it('carries the engine day estimate onto the stream row', async () => {
    state.streamRemaining = 1400;
    state.streamDaysToFinish = 3;

    const { result } = await jobs();
    const stream = result.current.find((job) => job.id === 'streamBackfill');
    expect(stream?.pacedDays).toBe(3);

    const detection = result.current.find((job) => job.id === 'detection');
    expect(detection?.pacedDays).toBeNull();
  });

  it('carries no day estimate when the engine reports none', async () => {
    state.streamRemaining = 40;
    state.streamDaysToFinish = null;

    const { result } = await jobs();
    expect(result.current.find((job) => job.id === 'streamBackfill')?.pacedDays).toBeNull();
  });

  it('reads a running stream pass with its progress and no resting count', async () => {
    state.stream = { phase: 'fetching', completed: 4, total: 20 };
    state.streamRemaining = null;

    const { result } = await jobs();
    const stream = result.current.find((job) => job.id === 'streamBackfill');

    expect(stream?.state).toBe('running');
    expect(stream?.completed).toBe(4);
    expect(stream?.total).toBe(20);
    expect(stream?.remaining).toBeNull();
  });

  it('reads a stream pass that failed as failed', async () => {
    state.stream = { phase: 'failed', completed: 1, total: 20 };

    const { result } = await jobs();

    expect(result.current.find((job) => job.id === 'streamBackfill')?.state).toBe('failed');
  });

  it('reads a stream pass held for consent as idle with its count', async () => {
    state.stream = { phase: 'awaiting_consent', completed: 0, total: 0 };
    state.streamRemaining = 300;

    const { result } = await jobs();
    const stream = result.current.find((job) => job.id === 'streamBackfill');

    expect(stream?.state).toBe('idle');
    expect(stream?.remaining).toBe(300);
  });

  /**
   * Scenario: the request budget holds a backfill part way through, so the
   * engine reports it waiting with the rest owed and the time it resumes.
   *
   * Expected behaviour: the row is waiting, not a finished run with some to
   * retry, and it carries both the owed count and the resume time.
   */
  it('reads a stream pass held by the request budget as waiting with its count and resume time', async () => {
    const resumesAt = Date.UTC(2026, 9, 20, 14, 30);
    state.stream = { phase: 'waiting', completed: 40, total: 1240, resumesAt };
    state.streamRemaining = 1200;

    const { result } = await jobs();
    const stream = result.current.find((job) => job.id === 'streamBackfill');

    expect(stream?.state).toBe('waiting');
    expect(stream?.remaining).toBe(1200);
    expect(stream?.resumesAt).toBe(resumesAt);
  });

  it('reads an elevation backfill held by the request budget as waiting with its resume time', async () => {
    const resumesAt = Date.UTC(2026, 9, 20, 14, 30);
    state.backfill = { phase: 'waiting', completed: 500, total: 3000, failed: 0, resumesAt };
    state.remaining = 2500;

    const { result } = await jobs();
    const elevation = result.current.find((job) => job.id === 'elevationBackfill');

    expect(elevation?.state).toBe('waiting');
    expect(elevation?.remaining).toBe(2500);
    expect(elevation?.resumesAt).toBe(resumesAt);
  });

  it('carries no resume time for a job that is not waiting', async () => {
    state.backfill = { phase: 'partial', completed: 8, total: 10, failed: 2, resumesAt: null };

    const { result } = await jobs();

    expect(result.current.every((job) => job.resumesAt === null)).toBe(true);
  });
});
