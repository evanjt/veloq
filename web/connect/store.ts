// Fetched screen data, one entry per screen, tagged with the connection's
// session. A drop bumps the session, so data from an old connection is never
// written or read.

export type Store = {
  /** Data for a screen, only if it belongs to `session`. */
  get: (screen: string, session: number) => unknown;
  /** Keep data for a screen; false when it came from a connection since dropped. */
  put: (screen: string, session: number, data: unknown) => boolean;
  /** A drop: forget everything and move on to `session`. */
  clear: (session: number) => void;
};

export function createStore(): Store {
  const screens = new Map<string, unknown>();
  let current = 0;
  return {
    get: (screen, session) => (session === current ? screens.get(screen) : undefined),
    put(screen, session, data) {
      if (session !== current) return false;
      screens.set(screen, data);
      return true;
    },
    clear(session) {
      screens.clear();
      current = session;
    },
  };
}
