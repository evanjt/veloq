/**
 * A record of what the preview render queue did, readable from `adb logcat` on
 * a release build.
 *
 * Every existing log in the snapshot pool is `__DEV__`-gated or a `console.log`,
 * and `babel.config.js` removes every console call but `error` from a release
 * bundle. So a stall on a real device leaves nothing behind, and the queue has
 * been diagnosed by reading the source twice already.
 *
 * The trace is a ring buffer rather than a running commentary. Per-card logging
 * in release is noise the moment the feed scrolls; what is wanted is the last
 * few dozen events at the moment the queue stops moving, which is the one
 * report that says how it got there.
 */

export type SnapshotQueueEventKind =
  | 'enqueue'
  | 'start'
  | 'complete'
  | 'fail'
  | 'retry'
  | 'drain'
  | 'throttled'
  | 'workerGone'
  | 'suspend'
  | 'resume'
  /** The watchdog reached its timeout and chose to keep waiting. */
  | 'watchdogHeld'
  /** The watchdog gave up and failed everything still queued. */
  | 'watchdogFired';

export interface SnapshotQueueEvent {
  /** Epoch milliseconds, handed in rather than read, so nothing here spends a clock. */
  at: number;
  kind: SnapshotQueueEventKind;
  activityId?: string;
  workerId?: number;
  /** Why, for the kinds that have a why. The watchdog's hold reason above all. */
  detail?: string;
}

/** How many events the buffer keeps. Two full worker passes over a feed page. */
export const TRACE_CAPACITY = 64;

/**
 * How many consecutive watchdog holds before the trace is worth dumping.
 *
 * A hold is the watchdog reaching its 15 s timeout and re-arming because a
 * worker still claims to be rendering, or because the pool is waiting out a
 * tile throttle. Both are legitimate once. Four in a row is a minute of a queue
 * that holds work and completes none, which is the field report's shape.
 */
export const HOLDS_BEFORE_REPORT = 4;

export interface SnapshotQueueTrace {
  record: (event: Omit<SnapshotQueueEvent, 'at'>, now: number) => void;
  events: () => readonly SnapshotQueueEvent[];
  /** One multi-line report: the queue's shape now, then the buffer oldest first. */
  report: (now: number, queued: number, inFlight: number) => string;
  clear: () => void;
}

export function createSnapshotQueueTrace(capacity: number = TRACE_CAPACITY): SnapshotQueueTrace {
  let events: SnapshotQueueEvent[] = [];

  return {
    record(event, now) {
      events.push({ ...event, at: now });
      if (events.length > capacity) events = events.slice(events.length - capacity);
    },
    events() {
      return events;
    },
    report(now, queued, inFlight) {
      const header = `[SnapshotQueue] stalled: ${queued} queued, ${inFlight} in flight`;
      if (events.length === 0) return `${header}\n  (no events recorded)`;
      const origin = events[0].at;
      const lines = events.map((event) => `  ${formatTraceEvent(event, origin)}`);
      return [`${header}, ${now - origin}ms of trace`, ...lines].join('\n');
    },
    clear() {
      events = [];
    },
  };
}

/** One event as a line, timed from the oldest event the buffer still holds. */
export function formatTraceEvent(event: SnapshotQueueEvent, origin: number): string {
  const parts = [`+${event.at - origin}ms`, event.kind];
  if (event.workerId !== undefined) parts.push(`w${event.workerId}`);
  if (event.activityId !== undefined) parts.push(event.activityId);
  if (event.detail !== undefined) parts.push(`(${event.detail})`);
  return parts.join(' ');
}

/**
 * Whether this hold is the one that dumps the trace.
 *
 * Once per run of holds, not every hold after the threshold: a pool that is
 * genuinely wedged holds for ever, and a line every 15 s for the rest of the
 * session buries the report it is trying to deliver.
 */
export function holdShouldReport(consecutiveHolds: number): boolean {
  return consecutiveHolds === HOLDS_BEFORE_REPORT;
}
