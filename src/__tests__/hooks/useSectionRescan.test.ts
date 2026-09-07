import { act, renderHook } from '@testing-library/react-native';
import { isRetryableStart, StartOutcome } from 'veloqrs';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { getEngine } from '@/shared/native/engine';

/**
 * Scenario: a detect started on one screen has to stay visible after the user
 * navigates away, which is what the preview's Keep does.
 * Expected behaviour: mounting the hook while a run holds the slot adopts it
 * and reports its progress, and publishes no before/after it never measured.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const listeners: Record<string, () => void> = {};

function announceDetectionApplied() {
  listeners.detectionApplied?.();
}

function engineWith(overrides: Record<string, unknown> = {}) {
  return {
    subscribe: jest.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
      return () => delete listeners[event];
    }),
    pollSectionDetection: jest.fn(() => 'idle'),
    getSectionDetectionProgress: jest.fn(() => ({
      phase: 'analyzing',
      completed: 3,
      total: 10,
      percent: 30,
    })),
    getFilteredSectionSummaries: jest.fn(() => ({ totalCount: 7 })),
    startSectionDetection: jest.fn(() => StartOutcome.Started),
    forceRedetectSections: jest.fn(() => StartOutcome.Started),
    ...overrides,
  };
}

describe('adopting a detect that is already running', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('picks up a run in flight at mount', () => {
    const engine = engineWith({ pollSectionDetection: jest.fn(() => 'running') });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());

    expect(result.current.isScanning).toBe(true);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.progress?.percent).toBe(30);
  });

  it('publishes no result for a run it did not start', async () => {
    const poll = jest.fn(() => 'running');
    mockedGetEngine.mockReturnValue(engineWith({ pollSectionDetection: poll }) as never);

    const { result } = renderHook(() => useSectionRescan());

    poll.mockReturnValue('complete');
    await act(async () => {
      announceDetectionApplied();
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it('adopts nothing when the engine is idle', () => {
    mockedGetEngine.mockReturnValue(engineWith() as never);

    const { result } = renderHook(() => useSectionRescan());

    expect(result.current.isScanning).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('still reports before and after for a run it started itself', async () => {
    const poll = jest.fn(() => 'running');
    mockedGetEngine.mockReturnValue(engineWith({ pollSectionDetection: poll }) as never);

    const { result } = renderHook(() => useSectionRescan());

    act(() => {
      result.current.forceRescan();
    });
    poll.mockReturnValue('complete');
    await act(async () => {
      announceDetectionApplied();
    });

    expect(result.current.result).toEqual({ before: 7, after: 7 });
  });
});

/**
 * Scenario: the rescan screen used to tick `pollSectionDetection` every
 * 500 ms, and the tick that saw completion ran the catalogue apply.
 * Expected behaviour: completion arrives on `detectionApplied`, and the timer
 * that remains reads progress alone.
 */
describe('following a rescan without draining the worker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads only progress on the timer', () => {
    const engine = engineWith({ pollSectionDetection: jest.fn(() => 'running') });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());
    act(() => {
      result.current.rescan();
    });
    const pollsAtStart = engine.pollSectionDetection.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(engine.pollSectionDetection).toHaveBeenCalledTimes(pollsAtStart);
    expect(engine.getSectionDetectionProgress).toHaveBeenCalled();
    expect(result.current.progress?.percent).toBe(30);
  });

  it('settles on the event and reports what the rescan changed', async () => {
    const engine = engineWith({ pollSectionDetection: jest.fn(() => 'running') });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());
    act(() => {
      result.current.rescan();
    });
    expect(result.current.isScanning).toBe(true);

    engine.pollSectionDetection.mockReturnValue('complete');
    await act(async () => {
      announceDetectionApplied();
    });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.result).toEqual({ before: 7, after: 7 });
  });

  it('ends the run on screen when the worker dies', async () => {
    const engine = engineWith({ pollSectionDetection: jest.fn(() => 'running') });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());
    act(() => {
      result.current.rescan();
    });

    engine.pollSectionDetection.mockReturnValue('error');
    await act(async () => {
      announceDetectionApplied();
    });

    expect(result.current.failed).toBe(true);
    expect(result.current.isScanning).toBe(false);
  });
});

/**
 * Scenario: a rescan the engine refuses used to answer `false` whether a run
 * already held the slot, the elevation backfill held detection, or the engine
 * was not open yet.
 * Expected behaviour: the verdict reaches the caller intact, so a screen can
 * tell the refusals that lift from the one that does not, and no refusal starts
 * the poll.
 */
describe('a refused rescan says why', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it('passes the engine refusal through rather than flattening it', () => {
    const engine = engineWith({
      startSectionDetection: jest.fn(() => StartOutcome.Busy),
      forceRedetectSections: jest.fn(() => StartOutcome.Held),
    });
    mockedGetEngine.mockReturnValue(engine as never);

    const { result } = renderHook(() => useSectionRescan());

    let started = StartOutcome.Started;
    act(() => {
      started = result.current.rescan();
    });
    expect(started).toBe(StartOutcome.Busy);
    expect(isRetryableStart(started)).toBe(true);
    expect(result.current.isScanning).toBe(false);

    act(() => {
      started = result.current.forceRescan();
    });
    expect(started).toBe(StartOutcome.Held);
    expect(result.current.isScanning).toBe(false);
  });

  it('says it was early, not refused, when no engine is open', () => {
    mockedGetEngine.mockReturnValue(null);

    const { result } = renderHook(() => useSectionRescan());

    let started = StartOutcome.Started;
    act(() => {
      started = result.current.rescan();
    });
    expect(started).toBe(StartOutcome.NotReady);
    expect(isRetryableStart(started)).toBe(true);
  });
});
