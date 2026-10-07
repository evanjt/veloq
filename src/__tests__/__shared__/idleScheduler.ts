/**
 * A stand-in for the global idle scheduler. `immediate` runs the callback inside
 * the call that schedules it, so a render that triggers work sees it finish.
 * `queued` holds it until `flush`, and `cancelIdleCallback` removes it as the
 * real one does.
 */
export interface IdleScheduler {
  /** Callbacks scheduled and neither run nor cancelled. */
  pending: () => number;
  /** Run everything pending, oldest first, including work scheduled by it. */
  flush: () => void;
  /** Put the platform's functions back. */
  restore: () => void;
}

export function stubIdleScheduler(mode: 'immediate' | 'queued'): IdleScheduler {
  const g = globalThis as unknown as Record<string, unknown>;
  const original = { request: g.requestIdleCallback, cancel: g.cancelIdleCallback };
  const queue = new Map<number, () => void>();
  let nextId = 1;
  const deadline = { didTimeout: false, timeRemaining: () => 50 };

  g.requestIdleCallback = (cb: (d: typeof deadline) => void): number => {
    const id = nextId++;
    if (mode === 'immediate') {
      cb(deadline);
    } else {
      queue.set(id, () => cb(deadline));
    }
    return id;
  };
  g.cancelIdleCallback = (id: number) => {
    queue.delete(id);
  };

  const flush = () => {
    while (queue.size > 0) {
      const [id, run] = queue.entries().next().value as [number, () => void];
      queue.delete(id);
      run();
    }
  };

  return {
    pending: () => queue.size,
    flush,
    restore: () => {
      g.requestIdleCallback = original.request;
      g.cancelIdleCallback = original.cancel;
    },
  };
}
