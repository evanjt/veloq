/**
 * Scenario: a page cached from before a deploy names a script generation that
 * the server no longer holds, so the module fails to load.
 *
 * Expected behaviour: the loader fetches the page again past the cache and
 * reloads, once per tab, so a stale page heals itself and a real outage does
 * not reload for ever.
 */

import { clearHealMark, healFailedLoad, type LoaderEnv } from '../../../web/connect/loader';

function environment(initial: Record<string, string> = {}) {
  const marks = new Map(Object.entries(initial));
  const calls: string[] = [];
  const env: LoaderEnv = {
    url: 'https://link.example.org/connect/',
    refetch: jest.fn(async (url: string, init: { cache: 'reload' }) => {
      calls.push(`refetch ${url} ${init.cache}`);
    }),
    reload: jest.fn(() => {
      calls.push('reload');
    }),
    marks: {
      get: (key) => marks.get(key) ?? null,
      set: (key, value) => void marks.set(key, value),
      remove: (key) => void marks.delete(key),
    },
  };
  return { env, calls, marks };
}

describe('connect page loader', () => {
  it('fetches the page past the cache, then reloads', async () => {
    const { env, calls } = environment();
    expect(await healFailedLoad(env)).toBe(true);
    expect(calls).toEqual(['refetch https://link.example.org/connect/ reload', 'reload']);
  });

  it('does neither on a second failure in the same tab', async () => {
    const { env, calls } = environment();
    await healFailedLoad(env);
    calls.length = 0;
    expect(await healFailedLoad(env)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('marks the tab before it fetches, so a failure during the fetch cannot loop', async () => {
    const { env, marks } = environment();
    (env.refetch as jest.Mock).mockImplementation(async () => {
      expect(marks.size).toBe(1);
    });
    await healFailedLoad(env);
  });

  it('reloads even when the fetch itself fails', async () => {
    const { env, calls } = environment();
    (env.refetch as jest.Mock).mockRejectedValue(new Error('offline'));
    expect(await healFailedLoad(env)).toBe(true);
    expect(calls).toEqual(['reload']);
  });

  it('does not reload when the tab cannot keep the mark', async () => {
    const { env, calls } = environment();
    env.marks.set = () => {
      throw new Error('storage is blocked');
    };
    expect(await healFailedLoad(env)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('heals again after a load that worked clears the mark', async () => {
    const { env, calls } = environment();
    await healFailedLoad(env);
    clearHealMark(env);
    calls.length = 0;
    expect(await healFailedLoad(env)).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
