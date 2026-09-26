/**
 * Which free worker a request should go to.
 *
 * The worker page takes a fast path only when the render it is given has the
 * same base style and the same mode as the one it last drew: then it jumps the
 * camera over a style already mounted. Anything else rebuilds the whole style
 * and waits for it to load, or five seconds, whichever comes first.
 *
 * The pool used to hand a request to whichever worker was free first, which on
 * a feed of ride, run, ride, run in `smart` 3D mode gave each worker flat,
 * drape, flat, drape, so every render paid the rebuild. Two workers and two
 * modes, so preferring a worker that already holds the right one lets each
 * settle on one.
 *
 * Preference only. A request is never held back waiting for its match: an idle
 * worker is worth more than a fast path, and a priority render is the card the
 * athlete is looking at.
 */

export interface SnapshotWorkerChoice<T> {
  worker: T;
  /** What the worker was last asked to draw, or null if it has drawn nothing. */
  lastRender: { mapStyle: string; flat: boolean } | null;
}

/** What makes two renders reuse a mounted style: the base style and the mode. */
function matches(
  lastRender: SnapshotWorkerChoice<unknown>['lastRender'],
  request: { mapStyle: string; flat?: boolean }
): boolean {
  if (!lastRender) return false;
  return lastRender.mapStyle === request.mapStyle && lastRender.flat === (request.flat === true);
}

/**
 * The first free worker whose last render this one can reuse, or the first
 * free worker.
 *
 * `free` is in pool order, so with nothing to prefer this returns exactly what
 * the plain loop did.
 */
export function pickSnapshotWorker<T>(
  free: SnapshotWorkerChoice<T>[],
  request: { mapStyle: string; flat?: boolean }
): T | null {
  if (free.length === 0) return null;
  const reusable = free.find((entry) => matches(entry.lastRender, request));
  return (reusable ?? free[0]).worker;
}
