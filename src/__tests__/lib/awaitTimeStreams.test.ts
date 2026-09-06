/**
 * Scenario: a screen has asked Rust for the `time` streams it is missing and
 * has to know when they land.
 *
 * Expected behaviour: the wait costs no engine reads. Rust announces each
 * stream with its activity id, and the wait ends when the last one it asked
 * for has landed, when the caller goes away, or when the timeout expires.
 */

import { awaitTimeStreams } from '@/features/routes/lib/awaitTimeStreams';
import { engine } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();
const mockSubscribe = jest.fn((event: string, callback: MockListener) => {
  const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
  forEvent.add(callback);
  mockListeners.set(event, forEvent);
  return () => forEvent.delete(callback);
});

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      subscribe: (event: string, callback: MockListener) => mockSubscribe(event, callback),
    },
  })
);

/** Stands in for the announcement Rust makes off the JS thread. */
function announce(activityIds: string[]) {
  mockListeners.get('timeStreamsStored')?.forEach((listener) => listener({ activityIds }));
}

function subscriberCount() {
  return mockListeners.get('timeStreamsStored')?.size ?? 0;
}

describe('awaitTimeStreams', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockListeners.clear();
    mockSubscribe.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ends when the last stream it asked for lands, reading nothing', async () => {
    const settled = jest.fn();
    const wait = awaitTimeStreams(['a1', 'a2'], { timeoutMs: 30_000 }).then(settled);

    announce(['a1']);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    announce(['a2']);
    await wait;

    expect(settled).toHaveBeenCalledWith(0);
    // The mock engine has no read method at all, so a re-read would throw.
    expect(Object.keys(engine)).toEqual(['subscribe']);
  });

  it('ignores an activity it never asked about', async () => {
    const settled = jest.fn();
    awaitTimeStreams(['a1'], { timeoutMs: 30_000 }).then(settled);

    announce(['other']);
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
  });

  it('gives up at the timeout with what never landed', async () => {
    const wait = awaitTimeStreams(['a1', 'a2'], { timeoutMs: 30_000 });

    announce(['a1']);
    jest.advanceTimersByTime(30_000);

    await expect(wait).resolves.toBe(1);
  });

  it('never subscribes for an empty batch', async () => {
    await expect(awaitTimeStreams([], { timeoutMs: 30_000 })).resolves.toBe(0);

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('reports what is left as each announcement lands', async () => {
    const onProgress = jest.fn();
    const wait = awaitTimeStreams(['a1', 'a2', 'a3'], { timeoutMs: 30_000, onProgress });

    announce(['a1']);
    announce(['a1']);
    announce(['a2', 'a3']);
    await wait;

    expect(onProgress.mock.calls).toEqual([[2], [0]]);
  });

  it('ends the wait when the caller goes away', async () => {
    const controller = new AbortController();
    const wait = awaitTimeStreams(['a1'], { timeoutMs: 30_000, signal: controller.signal });

    controller.abort();

    await expect(wait).resolves.toBe(1);
    expect(subscriberCount()).toBe(0);
  });

  it('does not subscribe when the caller has already gone away', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      awaitTimeStreams(['a1'], { timeoutMs: 30_000, signal: controller.signal })
    ).resolves.toBe(1);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('leaves no subscription or timer behind once it settles', async () => {
    const wait = awaitTimeStreams(['a1'], { timeoutMs: 30_000 });
    announce(['a1']);
    await wait;

    expect(subscriberCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('hears a second batch without restarting the wait', async () => {
    const first = awaitTimeStreams(['a1'], { timeoutMs: 30_000 });
    announce(['a1']);
    await first;

    const second = awaitTimeStreams(['a2'], { timeoutMs: 30_000 });
    announce(['a2']);

    await expect(second).resolves.toBe(0);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });
});
