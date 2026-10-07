/**
 * A record of what the preview render queue did, readable from the debug screen on
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
  /** A full queue dropped a waiting request. The card is told nothing. */
  | 'evict'
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
  activityId?: string | undefined;
  workerId?: number | undefined;
  /** Why, for the kinds that have a why. The watchdog's hold reason above all. */
  detail?: string | undefined;
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
  /**
   * One multi-line report: the queue's shape now, then the buffer oldest first.
   * The header word is the caller's: `stalled` is only true of the watchdog's dump.
   */
  report: (
    now: number,
    queued: number,
    inFlight: number,
    word: 'stalled' | 'queue' | 'idle'
  ) => string;
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
    report(now, queued, inFlight, word) {
      const header = `[SnapshotQueue] ${word}: ${queued} queued, ${inFlight} in flight`;
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

interface PublishedTrace {
  trace: SnapshotQueueTrace;
  shape: () => { queued: number; inFlight: number };
}

let published: PublishedTrace | null = null;

/**
 * Make the pool's trace readable from outside its component.
 *
 * A release bundle carries no console channel to logcat, so the trace is read
 * on the handset by the debug screen. The newest pool replaces the one before
 * it, and passing `null` forgets the trace.
 */
export function publishSnapshotQueueTrace(
  trace: SnapshotQueueTrace | null,
  shape: PublishedTrace['shape'] = () => ({ queued: 0, inFlight: 0 })
): void {
  published = trace === null ? null : { trace, shape };
}

/**
 * The pool is gone. Its events stay readable, since a stall is read after the
 * feed has been left, and the shape freezes at the last values it reported.
 * A trace already replaced by a newer pool is left alone.
 */
export function unpublishSnapshotQueueShape(trace: SnapshotQueueTrace): void {
  if (published === null || published.trace !== trace) return;
  published = { trace, shape: frozenShape(published.shape()) };
}

function frozenShape(shape: { queued: number; inFlight: number }): PublishedTrace['shape'] {
  return () => shape;
}

/**
 * The published trace as a report, or null when no pool has published one.
 * The span is timed to the newest event, so the read spends no clock.
 */
export function readSnapshotQueueReport(): string | null {
  if (published === null) return null;
  const { queued, inFlight } = published.shape();
  const newest = published.trace.events().at(-1)?.at ?? 0;
  const word = queued === 0 && inFlight === 0 ? 'idle' : 'queue';
  return published.trace.report(newest, queued, inFlight, word);
}
