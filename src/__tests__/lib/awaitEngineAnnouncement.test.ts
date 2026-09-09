/**
 * Scenario: a caller needs one result that Rust will announce, and the two
 * helpers that wait for one were written an hour apart by agents who could not
 * see each other.
 * Expected behaviour: the deadline, the abort and the unsubscribe are covered
 * once, here, rather than once per caller.
 */

import { awaitEngineAnnouncement } from '@/shared/native/awaitEngineAnnouncement';

describe('awaitEngineAnnouncement', () => {
  let listener: ((payload?: unknown) => void) | null = null;
  let unsubscribe: jest.Mock;

  const subscribe = (_channel: string, cb: (payload?: unknown) => void) => {
    listener = cb;
    return unsubscribe;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    listener = null;
    unsubscribe = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function wait(read: (payload?: unknown) => string | undefined, signal?: AbortSignal) {
    return awaitEngineAnnouncement<string>({
      channel: 'anything',
      timeoutMs: 1000,
      read,
      onDeadline: () => 'deadline',
      subscribe,
      signal,
    });
  }

  it('settles on the announcement its reader accepts', async () => {
    const promise = wait((p) => (p === 'mine' ? 'got it' : undefined));

    listener?.('not mine');
    listener?.('mine');

    await expect(promise).resolves.toBe('got it');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('settles on the deadline when nothing it wants arrives', async () => {
    const promise = wait(() => undefined);

    jest.advanceTimersByTime(1000);

    await expect(promise).resolves.toBe('deadline');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops listening after it has settled', async () => {
    const promise = wait(() => 'first');
    listener?.('one');
    await promise;

    const before = unsubscribe.mock.calls.length;
    listener?.('two');
    jest.advanceTimersByTime(5000);

    expect(unsubscribe.mock.calls.length).toBe(before);
  });

  it('answers the deadline value to a caller that aborts', async () => {
    const controller = new AbortController();
    const promise = wait(() => undefined, controller.signal);

    controller.abort();

    await expect(promise).resolves.toBe('deadline');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('never subscribes for a caller that has already gone', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(wait(() => 'ignored', controller.signal)).resolves.toBe('deadline');
    expect(listener).toBeNull();
  });

  it('keeps waiting when the reader returns undefined', async () => {
    const seen: unknown[] = [];
    const promise = wait((p) => {
      seen.push(p);
      return undefined;
    });

    listener?.('a');
    listener?.('b');
    jest.advanceTimersByTime(1000);

    await expect(promise).resolves.toBe('deadline');
    expect(seen).toEqual(['a', 'b']);
  });
});
