/**
 * Scenario: every request that stays in TypeScript, the OAuth proxy, the push
 * token and WebDAV, was a plain fetch with no deadline. A connection that takes
 * the SYN and answers nothing held sign-in or a backup until the platform socket
 * timeout gave up, which on Android is minutes.
 *
 * Expected behaviour: each wait has a ceiling, the request is abandoned at it,
 * and the failure says it timed out rather than looking like a server verdict.
 */

import {
  NET_DEADLINE_MS,
  FetchTimeoutError,
  fetchWithDeadline,
} from '@/shared/net/fetchWithDeadline';

describe('a fetch with a deadline', () => {
  it('answers with the response that arrives inside it', async () => {
    const send = jest.fn(async () => ({ ok: true }) as Response);

    await expect(fetchWithDeadline('https://x/y', {}, 50, send)).resolves.toEqual({ ok: true });
  });

  it('gives up at the ceiling and says so', async () => {
    const send = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const failure = await fetchWithDeadline('https://x/y', {}, 20, send).catch((e) => e);

    expect(failure).toBeInstanceOf(FetchTimeoutError);
    expect((failure as FetchTimeoutError).ms).toBe(20);
  });

  it('abandons the request rather than leaving it running', async () => {
    let seen: AbortSignal | undefined;
    // A hung request, answered the way fetch answers an abort.
    const send = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    );

    await fetchWithDeadline('https://x/y', {}, 10, send).catch(() => undefined);

    expect(seen?.aborted).toBe(true);
  });

  it('passes a real network failure through untouched', async () => {
    const send = jest.fn(async () => {
      throw new Error('Network request failed');
    });

    const failure = await fetchWithDeadline('https://x/y', {}, 500, send).catch((e) => e);

    expect(failure).not.toBeInstanceOf(FetchTimeoutError);
    expect((failure as Error).message).toBe('Network request failed');
  });

  it('keeps no timer running once the response is in', async () => {
    jest.useFakeTimers();
    try {
      const send = jest.fn(async () => ({ ok: true }) as Response);
      await fetchWithDeadline('https://x/y', {}, 1000, send);

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('takes the interactive ceiling from the lane the engine already uses', () => {
    expect(NET_DEADLINE_MS.interactive).toBe(10_000);
    expect(NET_DEADLINE_MS.transfer).toBe(30_000);
  });
});
