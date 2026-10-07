/**
 * Scenario: the engine opened but its observer was withheld, so nothing will
 * ever be announced. The sync line reads the status once on subscribe and the
 * feed re-reads its stored count on `activitiesStored`, and neither event
 * comes.
 *
 * Expected behaviour: while events are dead the status is re-read on a one
 * second timer, so the line moves and the settle is seen. The timer stops the
 * moment events are live again, and a handle that says nothing about its
 * events is taken as live, which is every handle that predates this.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import {
  FALLBACK_TICK_MS,
  reconsiderFallback,
  subscribeToFallbackTick,
} from '@/shared/native/eventFallback';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { SyncState, type SyncStatus } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function status(state: SyncStatus['state'], completed: number): SyncStatus {
  return { state, completed, total: 7, inFlight: 0, lastError: undefined } as unknown as SyncStatus;
}

function fakeEngine(live: boolean, first: SyncStatus) {
  const listeners = new Map<string, Set<() => void>>();
  let current = first;
  let alive = live;
  return {
    setSnapshot: (s: SyncStatus) => {
      current = s;
    },
    setLive: (value: boolean) => {
      alive = value;
    },
    eventsAreLive: jest.fn(() => alive),
    getSyncStatus: jest.fn(() => current),
    triggerRefresh: jest.fn(),
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

afterEach(() => jest.useRealTimers());

describe('the sync line when nothing can be announced', () => {
  it('re-reads the status on the timer, so the line moves', () => {
    const engine = fakeEngine(false, status(SyncState.Syncing, 0));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useSyncStatus());
    expect(result.current?.completed).toBe(0);

    engine.setSnapshot(status(SyncState.Syncing, 4));
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS));

    expect(result.current?.completed).toBe(4);
  });

  it('sees the settle, which is the transition nothing else would report', () => {
    const engine = fakeEngine(false, status(SyncState.Syncing, 6));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useSyncStatus());

    engine.setSnapshot(status(SyncState.Idle, 7));
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS));

    expect(result.current?.state).toBe(SyncState.Idle);
  });

  it('costs nothing while the engine can announce', () => {
    const engine = fakeEngine(true, status(SyncState.Syncing, 0));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);

    renderHook(() => useSyncStatus());
    expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(engine.getSyncStatus).toHaveBeenCalledTimes(1);
  });

  it('stops the moment events come back', () => {
    const engine = fakeEngine(false, status(SyncState.Syncing, 0));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    const ticked = jest.fn();

    const unsubscribe = subscribeToFallbackTick(ticked);
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS));
    expect(ticked).toHaveBeenCalledTimes(1);

    engine.setLive(true);
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(ticked).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('takes a handle that cannot say as able to announce', () => {
    mockGetEngine.mockReturnValue({
      getSyncStatus: jest.fn(() => status(SyncState.Syncing, 0)),
      subscribe: jest.fn(() => () => {}),
    } as unknown as ReturnType<typeof getEngine>);
    const ticked = jest.fn();

    const unsubscribe = subscribeToFallbackTick(ticked);
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(ticked).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('takes a handle that throws as unable, and polls', () => {
    mockGetEngine.mockReturnValue({
      eventsAreLive: jest.fn(() => {
        throw new Error('bridge gone');
      }),
      getSyncStatus: jest.fn(() => status(SyncState.Syncing, 0)),
      subscribe: jest.fn(() => () => {}),
    } as unknown as ReturnType<typeof getEngine>);
    const ticked = jest.fn();

    const unsubscribe = subscribeToFallbackTick(ticked);
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS));

    expect(ticked).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('drops the timer when the last subscriber goes', () => {
    const engine = fakeEngine(false, status(SyncState.Syncing, 0));
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    const ticked = jest.fn();

    const unsubscribe = subscribeToFallbackTick(ticked);
    unsubscribe();
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 5));

    expect(ticked).not.toHaveBeenCalled();
  });
});

describe('the fallback timer against a closed engine', () => {
  it('schedules nothing while the engine is closed, and starts once it opens', () => {
    const engine = { ...fakeEngine(false, status(SyncState.Idle, 0)), ready: false };
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    const tick = jest.fn();

    const off = subscribeToFallbackTick(tick);
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS * 3));
    expect(tick).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    engine.ready = true;
    reconsiderFallback();
    act(() => jest.advanceTimersByTime(FALLBACK_TICK_MS));
    expect(tick).toHaveBeenCalledTimes(1);
    off();
  });
});
