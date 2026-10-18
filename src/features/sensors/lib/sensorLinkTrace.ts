/**
 * A record of what each sensor link did, readable from the debug screen on a
 * release build.
 *
 * Every sensor log line goes through `debug.create`, which is silent outside
 * `__DEV__`, and `babel.config.js` removes every console call but `error` from
 * a release bundle. So a strap that connects, accepts its subscription and
 * sends nothing leaves no word of whether the notification enable failed, when
 * the first frame landed, or when the watchdog gave up on it.
 *
 * The trace is a ring buffer kept for the life of the process, so it is still
 * there once the recording screen has closed and the ride is discarded. The
 * notification path writes to it once per monitor, on the first frame; every
 * later frame is a counter increment on the manager's side.
 */

export type SensorLinkEventKind =
  | 'connectStart'
  /** `ms` is how long the connect took. */
  | 'connected'
  /** `ms` is how long service discovery took. */
  | 'discovered'
  | 'monitorRegistered'
  /** `detail` is the stack's message. */
  | 'monitorError'
  /** `ms` is the time since this characteristic's monitor was registered. */
  | 'firstSample'
  /** Written per characteristic on teardown, `count` the frames it carried. */
  | 'sampleCount'
  /** `ms` is how long the link had been silent. */
  | 'watchdogFired'
  | 'teardown'
  /** `ms` is the delay before the next connect. */
  | 'reconnectScheduled'
  /** The Bluetooth stack reported the link gone. */
  | 'disconnected'
  /** Waiting for the radio to come on or be granted. */
  | 'parked';

export interface SensorLinkEvent {
  /** Epoch milliseconds, handed in rather than read, so nothing here spends a clock. */
  at: number;
  sensorId: string;
  sensorName: string;
  kind: SensorLinkEventKind;
  /** The characteristic UUID, for the kinds that concern one monitor. */
  characteristic?: string | undefined;
  ms?: number | undefined;
  count?: number | undefined;
  detail?: string | undefined;
}

/**
 * How many events the buffer keeps. A silent link loops through about eight
 * events every fourteen seconds, so this holds several minutes of one.
 */
export const SENSOR_LINK_TRACE_CAPACITY = 256;

export interface SensorLinkTrace {
  record: (event: Omit<SensorLinkEvent, 'at'>, now: number) => void;
  events: () => readonly SensorLinkEvent[];
  clear: () => void;
}

export function createSensorLinkTrace(
  capacity: number = SENSOR_LINK_TRACE_CAPACITY
): SensorLinkTrace {
  let events: SensorLinkEvent[] = [];

  return {
    record(event, now) {
      events.push({ ...event, at: now });
      if (events.length > capacity) events = events.slice(events.length - capacity);
    },
    events() {
      return events;
    },
    clear() {
      events = [];
    },
  };
}

/** One event as a line, timed from the oldest event the buffer still holds. */
export function formatSensorLinkEvent(event: SensorLinkEvent, origin: number): string {
  const parts = [`+${event.at - origin}ms`, event.sensorName, event.kind];
  if (event.characteristic !== undefined) parts.push(event.characteristic);
  if (event.ms !== undefined) parts.push(`${event.ms}ms`);
  if (event.count !== undefined) parts.push(`x${event.count}`);
  if (event.detail !== undefined) parts.push(`(${event.detail})`);
  return parts.join(' ');
}

const trace = createSensorLinkTrace();

export function recordSensorLink(event: Omit<SensorLinkEvent, 'at'>): void {
  trace.record(event, Date.now());
}

export function sensorLinkEvents(): readonly SensorLinkEvent[] {
  return trace.events();
}

export function clearSensorLinkTrace(): void {
  trace.clear();
}

/** The trace as one report, oldest first, or null when no link has been opened this process. */
export function readSensorLinkReport(): string | null {
  const events = trace.events();
  const oldest = events.at(0);
  const newest = events.at(-1);
  if (oldest === undefined || newest === undefined) return null;
  const origin = oldest.at;
  const span = newest.at - origin;
  const header = `[SensorLinks] ${events.length} events, ${span}ms of trace`;
  return [header, ...events.map((event) => `  ${formatSensorLinkEvent(event, origin)}`)].join('\n');
}
