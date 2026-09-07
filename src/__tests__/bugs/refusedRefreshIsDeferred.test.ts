/**
 * Scenario: the athlete pulls to refresh while a sync already holds the
 * exclusive slot. `syncNow()` refuses, every caller discards the answer, and
 * the gesture resolves over unchanged data.
 *
 * Expected behaviour: a refused refresh is not dropped. It runs when the slot
 * frees, so the pull the athlete made reaches intervals.icu rather than
 * redrawing what the last sync wrote.
 */

import type { getEngine } from '@/shared/native/engine';

// One instance across `jest.resetModules()`, so the fresh copy of the module
// under test still talks to the engine each case set up.
const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({ getEngine: mockGetEngine }));

/**
 * The deferral is module state, and a module holds it for the life of the
 * process. Each case gets its own copy so one pull left pending does not
 * arrive in the next.
 */
function requestSyncRefresh(): boolean {
  return (
    require('@/shared/native/syncRefresh') as typeof import('@/shared/native/syncRefresh')
  ).requestSyncRefresh();
}

function engineThatRefuses(answers: boolean[]) {
  const listeners: Record<string, (() => void)[]> = {};
  const syncNow = jest.fn(() => answers.shift() ?? true);
  // The real unsubscribe drops the listener, and a fake that only counts calls
  // leaves a retired one to fire again on the next settle.
  const unsubscribe = jest.fn();
  const engine = {
    syncNow,
    subscribe: jest.fn((channel: string, listener: () => void) => {
      const forChannel = (listeners[channel] ??= []);
      forChannel.push(listener);
      return () => {
        unsubscribe();
        const at = forChannel.indexOf(listener);
        if (at >= 0) forChannel.splice(at, 1);
      };
    }),
  };
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  return {
    syncNow,
    subscribe: engine.subscribe,
    unsubscribe,
    settle: () => [...(listeners.syncSettled ?? [])].forEach((listener) => listener()),
    listeners,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe('a refresh refused because a sync holds the slot', () => {
  it('runs when the sync settles', () => {
    const engine = engineThatRefuses([false]);

    expect(requestSyncRefresh()).toBe(false);
    expect(engine.syncNow).toHaveBeenCalledTimes(1);

    engine.settle();

    expect(engine.syncNow).toHaveBeenCalledTimes(2);
  });

  it('waits for the slot rather than watching every sync event', () => {
    const engine = engineThatRefuses([false]);

    requestSyncRefresh();

    expect(engine.subscribe).toHaveBeenCalledTimes(1);
    expect(engine.subscribe).toHaveBeenCalledWith('syncSettled', expect.any(Function));
  });

  it('lets go of the listener once the deferred refresh has run', () => {
    const engine = engineThatRefuses([false]);

    requestSyncRefresh();
    engine.settle();

    expect(engine.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('holds one deferred refresh however many times the athlete pulls', () => {
    const engine = engineThatRefuses([false, false, false]);

    requestSyncRefresh();
    requestSyncRefresh();
    requestSyncRefresh();
    expect(engine.subscribe).toHaveBeenCalledTimes(1);

    engine.settle();

    expect(engine.syncNow).toHaveBeenCalledTimes(4);
  });

  it('tries again on the next settle when the slot was taken first', () => {
    const engine = engineThatRefuses([false, false]);

    requestSyncRefresh();
    engine.settle();
    expect(engine.syncNow).toHaveBeenCalledTimes(2);

    engine.settle();

    expect(engine.syncNow).toHaveBeenCalledTimes(3);
  });
});

describe('a refresh that is accepted', () => {
  it('defers nothing', () => {
    const engine = engineThatRefuses([true]);

    expect(requestSyncRefresh()).toBe(true);
    expect(engine.subscribe).not.toHaveBeenCalled();
  });
});

describe('no engine', () => {
  it('is not a refusal to defer, because there is nothing to defer to', () => {
    mockGetEngine.mockReturnValue(null);

    expect(requestSyncRefresh()).toBe(false);
  });
});
