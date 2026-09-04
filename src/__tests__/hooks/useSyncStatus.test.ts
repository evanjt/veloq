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
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import type { SyncStatus } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(state: SyncStatus['state'], completed: number): SyncStatus {
  return {
    state,
    completed,
    total: 3,
    inFlight: state === 'syncing' ? 1 : 0,
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

it('reads once at mount and never on a timer', () => {
  const engine = fakeEngine(status('syncing', 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = renderHook(() => useSyncStatus());
  expect(result.current?.state).toBe('syncing');
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(30_000);
  });
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);
});

it('re-reads when the engine announces a step', () => {
  const engine = fakeEngine(status('syncing', 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = renderHook(() => useSyncStatus());
  engine.setSnapshot(status('syncing', 2));
  act(() => {
    engine.announce('syncProgress');
  });

  expect(result.current?.completed).toBe(2);
});

it('re-reads when the engine announces the settle', () => {
  const engine = fakeEngine(status('syncing', 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { result } = renderHook(() => useSyncStatus());
  engine.setSnapshot(status('idle', 3));
  act(() => {
    engine.announce('syncSettled');
  });

  expect(result.current?.state).toBe('idle');
});

it('drops its subscriptions on unmount', () => {
  const engine = fakeEngine(status('idle', 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const { unmount } = renderHook(() => useSyncStatus());
  unmount();

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});
