/**
 * Scenario: the engine's observer is live, but the settle announcement never
 * reaches the listener map (it was queued under an observer that has since
 * been replaced, or dropped while the registration was cleared and set again).
 * The engine is idle and the stored status says so, yet the hook still holds
 * the last `Syncing` snapshot.
 *
 * Expected behaviour: a snapshot that says a sync is running is re-read on a
 * slow timer even when events are live, so the line leaves its step. Nothing
 * polls while the snapshot is idle.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { SYNC_RUNNING_REREAD_MS, useSyncStatus } from '@/shared/native/useSyncStatus';
import { SyncState, SyncStep, type SyncStatus } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(state: SyncStatus['state']): SyncStatus {
  return {
    state,
    step: state === SyncState.Syncing ? SyncStep.Activities : undefined,
    completed: 0,
    total: 7,
    inFlight: 0,
    lastError: undefined,
  } as unknown as SyncStatus;
}

function liveEngine(first: SyncStatus) {
  let current = first;
  return {
    setSnapshot: (s: SyncStatus) => {
      current = s;
    },
    eventsAreLive: jest.fn(() => true),
    getSyncStatus: jest.fn(() => current),
    subscribe: jest.fn(() => () => {}),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => jest.useRealTimers());

describe('the sync line when a settle announcement is lost', () => {
  it('leaves the running step once the engine is idle', () => {
    const engine = liveEngine(status(SyncState.Syncing));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useSyncStatus());
    expect(result.current?.state).toBe(SyncState.Syncing);

    engine.setSnapshot(status(SyncState.Idle));
    act(() => jest.advanceTimersByTime(SYNC_RUNNING_REREAD_MS));

    expect(result.current?.state).toBe(SyncState.Idle);
  });

  it('stops re-reading once the snapshot is idle', () => {
    const engine = liveEngine(status(SyncState.Syncing));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    renderHook(() => useSyncStatus());
    engine.setSnapshot(status(SyncState.Idle));
    act(() => jest.advanceTimersByTime(SYNC_RUNNING_REREAD_MS));
    const reads = engine.getSyncStatus.mock.calls.length;

    act(() => jest.advanceTimersByTime(SYNC_RUNNING_REREAD_MS * 5));

    expect(engine.getSyncStatus).toHaveBeenCalledTimes(reads);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never polls an engine that opened idle', () => {
    const engine = liveEngine(status(SyncState.Idle));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    renderHook(() => useSyncStatus());
    act(() => jest.advanceTimersByTime(SYNC_RUNNING_REREAD_MS * 5));

    expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);
  });
});
