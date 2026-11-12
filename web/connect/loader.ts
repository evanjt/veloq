// Starts the page from a cached page that names a script generation the
// server no longer holds. The page and its scripts are cached separately, so
// the page can be older than the scripts it names. A failed load fetches the
// page again past the cache and reloads, once per tab: a page that was only
// stale heals, and a server that is really down does not reload for ever.

/** What the loader needs from the browser, so it runs without one. */
export type LoaderEnv = {
  /** The address of the page itself. */
  url: string;
  /** Fetch `url` and replace what the cache holds for it. */
  refetch: (url: string, init: { cache: 'reload' }) => Promise<unknown>;
  reload: () => void;
  /** Per-tab storage, for the mark that stops a second attempt. */
  marks: {
    get: (key: string) => string | null;
    set: (key: string, value: string) => void;
    remove: (key: string) => void;
  };
};

const MARK = 'veloq-connect-reloaded';

/**
 * Fetch the page afresh and reload, unless this tab already tried.
 * Resolves true when it reloaded. A tab that cannot keep the mark never
 * reloads, since it could not tell a second failure from a first.
 */
export async function healFailedLoad(env: LoaderEnv): Promise<boolean> {
  try {
    if (env.marks.get(MARK) !== null) return false;
    env.marks.set(MARK, '1');
  } catch {
    return false;
  }
  try {
    await env.refetch(env.url, { cache: 'reload' });
  } catch {
    // Offline or refused: the reload below shows the browser's own error.
  }
  env.reload();
  return true;
}

/** Forget an earlier attempt, after a load that worked. */
export function clearHealMark(env: LoaderEnv): void {
  try {
    env.marks.remove(MARK);
  } catch {
    // Nothing was kept.
  }
}

/** The loader's environment in a browser. */
export function browserEnvironment(): LoaderEnv {
  return {
    url: location.href,
    refetch: (url, init) => fetch(url, init),
    reload: () => location.reload(),
    marks: {
      get: (key) => sessionStorage.getItem(key),
      set: (key, value) => sessionStorage.setItem(key, value),
      remove: (key) => sessionStorage.removeItem(key),
    },
  };
}
