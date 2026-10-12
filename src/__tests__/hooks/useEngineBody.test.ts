/**
 * Scenario: an on-demand body settles on a Rust thread. The hook awaiting it
 * read a counter over the bridge twice a second until the count moved, so a
 * chart open on a slow connection paid an FFI read per tick for nothing.
 *
 * Expected behaviour: the hook asks once, then waits for the engine to
 * announce the landing. No engine call happens between the request and the
 * event.
 *
 * And it does not wait for ever. A request that Rust refused outright, which
 * it does with a bare `false` nobody can read, is announced by nothing, so a
 * screen waiting on the announcement alone spins until it is closed. The wait
 * has a deadline and a state the caller can act on when it passes.
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { BODY_WAIT_MS, useEngineBody } from '@/shared/native/engineBodies';
import { getEngine } from '@/shared/native/engine';
import { StartOutcome } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline }),
  useIsOnline: () => mockIsOnline,
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function fakeEngine() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    announce: (channel: string) => listeners.get(channel)?.forEach((cb) => cb()),
    getBodiesStored: jest.fn(() => 0),
    triggerRefresh: jest.fn(),
    subscribe: jest.fn((channel: string, cb: () => void) => {
      const set = listeners.get(channel) ?? new Set<() => void>();
      listeners.set(channel, set);
      set.add(cb);
      return () => set.delete(cb);
    }),
  };
}

const KEY = ['body', 'a1'];

let client: QueryClient;
let engine: ReturnType<typeof fakeEngine>;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockIsOnline = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  engine = fakeEngine();
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

it('asks once and then makes no engine call on a timer', async () => {
  const request = jest.fn();
  await renderHook(() => useEngineBody(false, request, KEY), { wrapper });

  expect(request).toHaveBeenCalledTimes(1);
  const before = engine.subscribe.mock.calls.length;
  // The two the mount spends reconciling the pre-subscription window. What
  // must never grow is the count after time passes, which is the timer this
  // hook is here not to have.
  const countReads = engine.getBodiesStored.mock.calls.length;

  await act(() => {
    jest.advanceTimersByTime(30_000);
  });

  expect(engine.getBodiesStored).toHaveBeenCalledTimes(countReads);
  expect(engine.triggerRefresh).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  expect(engine.subscribe.mock.calls.length).toBe(before);
});

it('invalidates its query when the engine announces a landing', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

  await act(() => {
    engine.announce('bodyStored');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
});

it('still invalidates on the coarse activities channel', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await renderHook(() => useEngineBody(true, jest.fn(), KEY), { wrapper });

  await act(() => {
    engine.announce('activities');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
});

it('does not ask for a body that is already present', async () => {
  const request = jest.fn();
  await renderHook(() => useEngineBody(true, request, KEY), { wrapper });

  expect(request).not.toHaveBeenCalled();
});

it('does nothing at all when disabled', async () => {
  const request = jest.fn();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await renderHook(() => useEngineBody(false, request, KEY, false), { wrapper });

  await act(() => {
    engine.announce('bodyStored');
    engine.announce('activities');
  });

  expect(request).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it('drops every subscription on unmount', async () => {
  const { unmount } = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
  await unmount();

  const live = [...engine.listeners.values()].reduce((n, set) => n + set.size, 0);
  expect(live).toBe(0);
});

it('leaves a second reader subscribed when the first unmounts', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const first = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
  await renderHook(() => useEngineBody(false, jest.fn(), ['body', 'a2']), { wrapper });
  await first.unmount();
  invalidate.mockClear();

  await act(() => {
    engine.announce('bodyStored');
  });

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['body', 'a2'] });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: KEY });
});

it('still asks when the engine is not up yet, and subscribes to nothing', async () => {
  mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);
  const request = jest.fn();
  const { unmount } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });

  expect(request).toHaveBeenCalledTimes(1);
  expect(engine.subscribe).not.toHaveBeenCalled();
  await expect((async () => unmount())()).resolves.not.toThrow();
});

/**
 * Scenario: the body lands between the request going out and the subscription
 * being registered. `body_stored` is announced to nobody, because nobody is
 * listening yet, and the query would wait for an event that has already
 * happened.
 *
 * Expected behaviour: the counter Rust keeps for exactly this window is read
 * once on either side of the request, and a count that moved invalidates the
 * query the announcement would have.
 */
describe('a body that lands before the subscription', () => {
  it('invalidates on the counter, since the announcement went to nobody', async () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    // Moves once, between the request effect and the subscribe effect.
    let count = 0;
    engine.getBodiesStored = jest.fn(() => {
      const now = count;
      count += 1;
      return now;
    });

    await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it('invalidates nothing when the count did not move', async () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    engine.getBodiesStored = jest.fn(() => 7);

    await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reads the counter twice and never on a timer', async () => {
    engine.getBodiesStored = jest.fn(() => 3);

    await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
    const reads = engine.getBodiesStored.mock.calls.length;

    await act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(reads).toBe(2);
    expect(engine.getBodiesStored).toHaveBeenCalledTimes(2);
  });

  it('reads no counter at all when the body is already present', async () => {
    engine.getBodiesStored = jest.fn(() => 0);

    await renderHook(() => useEngineBody(true, jest.fn(), KEY), { wrapper });

    expect(engine.getBodiesStored).not.toHaveBeenCalled();
  });

  it('reads no counter when the hook is disabled', async () => {
    engine.getBodiesStored = jest.fn(() => 0);

    await renderHook(() => useEngineBody(false, jest.fn(), KEY, false), { wrapper });

    expect(engine.getBodiesStored).not.toHaveBeenCalled();
  });
});

describe('the deadline', () => {
  it('reports waiting while the request is outstanding', async () => {
    const { result } = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

    expect(result.current.status).toBe('waiting');
  });

  it('gives up at the deadline and says so', async () => {
    const { result } = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS - 1);
    });
    expect(result.current.status).toBe('waiting');

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe('timedOut');
  });

  it('reads nothing and asks for nothing when it expires', async () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const request = jest.fn();
    await renderHook(() => useEngineBody(false, request, KEY), { wrapper });
    invalidate.mockClear();
    const reads = engine.getBodiesStored.mock.calls.length;

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });

    // The deadline ends the wait. It is not a retry and it is not a poll, so
    // the hook still costs no engine call between the request and the event.
    expect(invalidate).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(engine.getBodiesStored).toHaveBeenCalledTimes(reads);
  });

  it('ends the wait when the body is actually present, not when one is announced', async () => {
    const { result, rerender } = await renderHook(
      ({ present }: { present: boolean }) => useEngineBody(present, jest.fn(), KEY),
      { wrapper, initialProps: { present: false } }
    );

    // An announcement on the coarse channel may be about some other body, so
    // it invalidates the query and nothing more. The deadline still stands.
    await act(() => {
      engine.announce('activities');
    });
    expect(result.current.status).toBe('waiting');

    await rerender({ present: true });
    expect(result.current.status).toBe('idle');

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS * 2);
    });
    expect(result.current.status).toBe('idle');
  });

  it('is idle from the start for a body that is already present', async () => {
    const { result } = await renderHook(() => useEngineBody(true, jest.fn(), KEY), { wrapper });

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS * 2);
    });

    expect(result.current.status).toBe('idle');
  });

  it('is idle when it is disabled, so a screen that asked for nothing never times out', async () => {
    const { result } = await renderHook(() => useEngineBody(false, jest.fn(), KEY, false), {
      wrapper,
    });

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS * 2);
    });

    expect(result.current.status).toBe('idle');
  });

  it('starts a fresh deadline when the parameters change', async () => {
    const { result, rerender } = await renderHook(
      ({ key }: { key: string[] }) => useEngineBody(false, jest.fn(), key),
      { wrapper, initialProps: { key: KEY } }
    );

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('timedOut');

    await rerender({ key: ['body', 'a2'] });
    expect(result.current.status).toBe('waiting');
  });

  it('asks again on a retry, and waits again', async () => {
    const request = jest.fn();
    const { result } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('timedOut');
    expect(request).toHaveBeenCalledTimes(1);

    await act(() => result.current.retry());

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('waiting');
  });

  it('runs the second deadline out too, rather than waiting for ever', async () => {
    const { result } = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    await act(() => result.current.retry());

    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('timedOut');
  });

  it('drops its timer on unmount', async () => {
    const { unmount } = await renderHook(() => useEngineBody(false, jest.fn(), KEY), { wrapper });
    await unmount();

    await expect(
      (async () =>
        act(() => {
          jest.advanceTimersByTime(BODY_WAIT_MS * 2);
        }))()
    ).resolves.not.toThrow();
  });
});

/**
 * Scenario: a body requested offline never arrives, the deadline passes and
 * the card offers a Retry. The network comes back with the screen still open.
 *
 * Expected behaviour: the offline to online edge asks again, exactly once, as
 * a retry would. A body already present, or a hook that is disabled, asks
 * nothing on the edge.
 */
describe('the reconnect edge', () => {
  async function goOffline(rerender: (props: object) => void) {
    mockIsOnline = false;
    await act(() => rerender({}));
  }

  async function comeBack(rerender: (props: object) => void) {
    mockIsOnline = true;
    await act(() => rerender({}));
  }

  it('asks once more for a body whose wait ran out offline, and waits again', async () => {
    const request = jest.fn();
    const { result, rerender } = await renderHook(() => useEngineBody(false, request, KEY), {
      wrapper,
    });
    await goOffline(rerender);
    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('timedOut');
    expect(request).toHaveBeenCalledTimes(1);

    await comeBack(rerender);

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('waiting');

    await act(async () => await rerender({}));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('asks nothing on the edge when the body is present', async () => {
    const request = jest.fn();
    const { rerender } = await renderHook(() => useEngineBody(true, request, KEY), { wrapper });
    await goOffline(rerender);

    await comeBack(rerender);

    expect(request).not.toHaveBeenCalled();
  });

  it('asks nothing on the edge when disabled', async () => {
    const request = jest.fn();
    const { result, rerender } = await renderHook(() => useEngineBody(false, request, KEY, false), {
      wrapper,
    });
    await goOffline(rerender);

    await comeBack(rerender);

    expect(request).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('asks nothing while the connection never drops', async () => {
    const request = jest.fn();
    const { rerender } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });
    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });

    await act(async () => await rerender({}));
    await act(async () => await rerender({}));

    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('a request the engine answers with a verdict', () => {
  it('ends the wait at once on a missing credential, which signing in fixes', async () => {
    const request = jest.fn(() => StartOutcome.NotConfigured);
    const { result } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });

    expect(result.current.status).toBe('notConfigured');
    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('notConfigured');
  });

  it('ends the wait at once on a start that threw', async () => {
    const { result } = await renderHook(
      () => useEngineBody(false, () => StartOutcome.Failed, KEY),
      {
        wrapper,
      }
    );
    expect(result.current.status).toBe('refused');
  });

  it.each([StartOutcome.Busy, StartOutcome.Held, StartOutcome.NotReady])(
    'keeps waiting to the deadline on %s',
    async (outcome) => {
      const { result } = await renderHook(() => useEngineBody(false, () => outcome, KEY), {
        wrapper,
      });

      expect(result.current.status).toBe('waiting');
      await act(() => {
        jest.advanceTimersByTime(BODY_WAIT_MS);
      });
      expect(result.current.status).toBe('timedOut');
    }
  );

  it('keeps waiting when there is no verdict to read', async () => {
    const { result } = await renderHook(() => useEngineBody(false, () => undefined, KEY), {
      wrapper,
    });
    expect(result.current.status).toBe('waiting');
  });

  it('leaves the refusal when retry asks again and is accepted', async () => {
    const request = jest
      .fn<StartOutcome, []>()
      .mockReturnValueOnce(StartOutcome.NotConfigured)
      .mockReturnValue(StartOutcome.Started);
    const { result } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });
    expect(result.current.status).toBe('notConfigured');

    await act(() => result.current.retry());
    expect(result.current.status).toBe('waiting');
  });
});

/**
 * Scenario: the device has told the engine it is offline, and a screen asks
 * for a body it has not downloaded. The engine answers `Offline` rather than
 * starting a fetch that cannot land.
 *
 * Expected behaviour: the wait ends at once as `offline`, with no deadline to
 * sit out, so the screen says what will fix it instead of spinning. The
 * reconnect edge asks again, and a `Started` then waits as any request does.
 */
describe('a request the engine answers offline', () => {
  it('reads offline at once and never times out', async () => {
    const request = jest.fn(() => StartOutcome.Offline);
    const { result } = await renderHook(() => useEngineBody(false, request, KEY), { wrapper });

    expect(result.current.status).toBe('offline');
    await act(() => {
      jest.advanceTimersByTime(BODY_WAIT_MS);
    });
    expect(result.current.status).toBe('offline');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reads the verdict inside a start result too', async () => {
    const { result } = await renderHook(
      () => useEngineBody(false, () => ({ outcome: StartOutcome.Offline }), KEY),
      { wrapper }
    );
    expect(result.current.status).toBe('offline');
  });

  it('asks again on the reconnect edge and waits for the landing', async () => {
    const request = jest
      .fn<StartOutcome, []>()
      .mockReturnValueOnce(StartOutcome.Offline)
      .mockReturnValue(StartOutcome.Started);
    mockIsOnline = false;
    const { result, rerender } = await renderHook(() => useEngineBody(false, request, KEY), {
      wrapper,
    });
    expect(result.current.status).toBe('offline');

    mockIsOnline = true;
    await act(() => rerender({}));

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('waiting');
  });
});
