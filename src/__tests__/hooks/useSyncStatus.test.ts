/**
 * Scenario: a sync runs on a Rust thread. The hook used to re-read a status
 * snapshot every 1.5 s because Rust had no way to announce a step or a settle,
 * so every counter and the terminal state reached the screen a cadence late.
 *
 * Expected behaviour: the hook reads once at mount and then only when the
 * engine announces, and makes no engine call at all on a timer.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import {
  TRACK_STAGE_REREAD_MS,
  useSyncLastError,
  useSyncState,
  useSyncStatus,
  useTrackStage,
} from '@/shared/native/useSyncStatus';
import { SyncState, TrackStep, type SyncStatus, type TrackStage } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(state: SyncStatus['state'], completed: number): SyncStatus {
  return {
    state,
    completed,
    total: 3,
    inFlight: state === SyncState.Syncing ? 1 : 0,
    lastError: undefined,
  } as unknown as SyncStatus;
}

function fakeEngine(first: SyncStatus) {
  const listeners = new Map<string, Set<() => void>>();
  let snapshot = first;
  return {
    listeners,
    setSnapshot: (s: SyncStatus) => {
      snapshot = s;
    },
    announce: (event: string) => listeners.get(event)?.forEach((cb) => cb()),
    getSyncStatus: jest.fn(() => snapshot),
    subscribe: jest.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)?.delete(cb);
    }),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('reads once at mount and never on a timer while idle', async () => {
  const engine = fakeEngine(status(SyncState.Idle, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = await renderHook(() => useSyncStatus());
  expect(result.current?.state).toBe(SyncState.Idle);
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);

  await act(() => {
    jest.advanceTimersByTime(30_000);
  });
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);
});

it('re-reads when the engine announces a step', async () => {
  const engine = fakeEngine(status(SyncState.Syncing, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = await renderHook(() => useSyncStatus());
  engine.setSnapshot(status(SyncState.Syncing, 2));
  await act(() => {
    engine.announce('syncProgress');
  });

  expect(result.current?.completed).toBe(2);
});

it('re-reads when the engine announces the settle', async () => {
  const engine = fakeEngine(status(SyncState.Syncing, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = await renderHook(() => useSyncStatus());
  engine.setSnapshot(status(SyncState.Idle, 3));
  await act(() => {
    engine.announce('syncSettled');
  });

  expect(result.current?.state).toBe(SyncState.Idle);
});

it('drops its subscriptions on unmount', async () => {
  const engine = fakeEngine(status(SyncState.Idle, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { unmount } = await renderHook(() => useSyncStatus());
  await unmount();

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});

it('does not re-render a state consumer for progress within the same state', async () => {
  const engine = fakeEngine(status(SyncState.Syncing, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  let renders = 0;
  const { result } = await renderHook(() => {
    renders += 1;
    return useSyncState();
  });
  const first = renders;

  engine.setSnapshot(status(SyncState.Syncing, 2));
  await act(() => engine.announce('syncProgress'));
  expect(result.current).toBe(SyncState.Syncing);
  expect(renders).toBe(first);

  engine.setSnapshot(status(SyncState.Idle, 3));
  await act(() => engine.announce('syncSettled'));
  expect(result.current).toBe(SyncState.Idle);
  expect(renders).toBe(first + 1);
});

it('does not re-render a last-error consumer for progress while the error is unchanged', async () => {
  const engine = fakeEngine(status(SyncState.Syncing, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  let renders = 0;
  const { result } = await renderHook(() => {
    renders += 1;
    return useSyncLastError();
  });
  const first = renders;

  engine.setSnapshot(status(SyncState.Syncing, 2));
  await act(() => engine.announce('syncProgress'));
  expect(renders).toBe(first);
  expect(result.current).toBeUndefined();

  engine.setSnapshot({ ...status(SyncState.Idle, 2), lastError: 'offline' } as SyncStatus);
  await act(() => engine.announce('syncSettled'));
  expect(result.current).toBe('offline');
  expect(renders).toBe(first + 1);
});

function downloading(completed: number, total: number): TrackStage {
  return {
    step: TrackStep.Downloading,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    heldByUpstream: false,
  };
}

function settledWith(tracks: TrackStage | undefined): SyncStatus {
  return { ...status(SyncState.Idle, 3), tracks } as SyncStatus;
}

it('follows a GPS pass the engine started after the sync settled, and stops with it', async () => {
  const engine = fakeEngine(settledWith(undefined));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  const { result } = await renderHook(() => useTrackStage());
  expect(result.current).toBeNull();

  engine.setSnapshot(settledWith(downloading(0, 12)));
  await act(() => engine.announce('syncProgress'));
  expect(result.current).toEqual(downloading(0, 12));

  // The pass announces only that it started, so its progress is read on the timer.
  engine.setSnapshot(settledWith(downloading(6, 12)));
  await act(() => {
    jest.advanceTimersByTime(TRACK_STAGE_REREAD_MS);
  });
  expect(result.current).toEqual(downloading(6, 12));

  engine.setSnapshot(settledWith(undefined));
  await act(() => {
    jest.advanceTimersByTime(TRACK_STAGE_REREAD_MS);
  });
  expect(result.current).toBeNull();

  const reads = engine.getSyncStatus.mock.calls.length;
  await act(() => {
    jest.advanceTimersByTime(30_000);
  });
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(reads);
});

it('wakes no reader for a timed read that found the stage where it was', async () => {
  const engine = fakeEngine(settledWith(downloading(2, 12)));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  let renders = 0;
  await renderHook(() => {
    renders += 1;
    return useSyncStatus();
  });
  const first = renders;

  engine.setSnapshot(settledWith(downloading(2, 12)));
  await act(() => {
    jest.advanceTimersByTime(TRACK_STAGE_REREAD_MS * 4);
  });

  expect(engine.getSyncStatus.mock.calls.length).toBeGreaterThan(1);
  expect(renders).toBe(first);
});
