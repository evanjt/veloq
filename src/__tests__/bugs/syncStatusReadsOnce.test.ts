/**
 * Scenario: seven components mount `useSyncStatus`, and Rust announces per sync
 * step. A per-instance subscription read the engine once per component per
 * event, so a single step cost seven blocking FFI calls.
 *
 * Expected behaviour: one engine read per announcement no matter how many
 * components are mounted, and the subscription drops when the last one goes.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { SyncState, type SyncStatus } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(state: SyncStatus['state'], completed: number): SyncStatus {
  return { state, completed, total: 7, inFlight: 0, lastError: undefined } as unknown as SyncStatus;
}

function fakeEngine(first: SyncStatus) {
  const listeners = new Map<string, Set<() => void>>();
  let current = first;
  return {
    listeners,
    liveListeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    setSnapshot: (s: SyncStatus) => {
      current = s;
    },
    announce: (event: string) => listeners.get(event)?.forEach((cb) => cb()),
    getSyncStatus: jest.fn(() => current),
    subscribe: jest.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)?.delete(cb);
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

it('reads once per announcement with seven components mounted', () => {
  const engine = fakeEngine(status(SyncState.Syncing, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const mounted = Array.from({ length: 7 }, () => renderHook(() => useSyncStatus()));
  expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);
  expect(engine.subscribe).toHaveBeenCalledTimes(3);

  engine.setSnapshot(status(SyncState.Syncing, 4));
  act(() => engine.announce('syncProgress'));

  expect(engine.getSyncStatus).toHaveBeenCalledTimes(2);
  mounted.forEach(({ result }) => expect(result.current?.completed).toBe(4));

  mounted.forEach(({ unmount }) => unmount());
  expect(engine.liveListeners()).toBe(0);
});

it('keeps reading for the survivors when one of several unmounts', () => {
  const engine = fakeEngine(status(SyncState.Idle, 0));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

  const first = renderHook(() => useSyncStatus());
  const second = renderHook(() => useSyncStatus());
  first.unmount();

  engine.setSnapshot(status(SyncState.Syncing, 1));
  act(() => engine.announce('sync'));

  expect(second.result.current?.completed).toBe(1);
  second.unmount();
});

it('attaches on a later subscriber when the engine was not open yet', () => {
  mockGetEngine.mockReturnValue(null as unknown as ReturnType<typeof getEngine>);
  const early = renderHook(() => useSyncStatus());
  expect(early.result.current).toBeNull();

  const engine = fakeEngine(status(SyncState.Syncing, 2));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  const late = renderHook(() => useSyncStatus());

  expect(late.result.current?.completed).toBe(2);
  early.unmount();
  late.unmount();
});
