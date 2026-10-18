import type { SensorConnectionStatus } from '../types';

/**
 * A subscribed sensor that has delivered nothing for this long has a link that
 * is not carrying data, whatever GATT says about it. Generous for a 1 Hz
 * profile, which is what every heart rate strap and power meter broadcasts.
 */
export const SENSOR_NO_DATA_MS = 10_000;

export interface SensorLinkState {
  /** `first` for the initial connect, `retry` once a reconnect is driving it. */
  attempt: 'first' | 'retry';
  /** When the characteristic monitors were registered, null before that. */
  subscribedAt: number | null;
  /** When this sensor last delivered a notification, null if it never has. */
  lastSampleAt: number | null;
  /** Times in a row the link was torn down for carrying nothing, 0 if never. */
  silentCycles?: number;
  now: number;
}

/**
 * What a sensor row should say, from where its connection got to and when it
 * last sent something.
 *
 * Registering the monitors is not evidence that data flows: a failed CCCD
 * write, a peripheral that advertises a service it does not populate, and a
 * strap whose battery dies mid-ride all leave a live GATT link that carries
 * nothing. So `connected` means a sample has landed, and a link that has gone
 * quiet for `SENSOR_NO_DATA_MS` reads as `noData` whether or not one ever did.
 * A link reconnected after silent cycles still reads `noData` until a sample
 * lands, since the reconnect is how it is being fixed, not news that it is.
 */
export function sensorConnectionHealth({
  attempt,
  subscribedAt,
  lastSampleAt,
  silentCycles = 0,
  now,
}: SensorLinkState): SensorConnectionStatus {
  const pending = silentCycles > 0 ? 'noData' : attempt === 'first' ? 'connecting' : 'reconnecting';
  if (subscribedAt === null) return pending;

  const since = lastSampleAt ?? subscribedAt;
  if (now - since >= SENSOR_NO_DATA_MS) return 'noData';
  return lastSampleAt === null ? pending : 'connected';
}

/** The longest a silent link is left subscribed before it is torn down again. */
export const SILENT_LINK_TEARDOWN_MAX_MS = 60_000;

/**
 * How long a link that has carried nothing is left subscribed before it is
 * torn down for a reconnect, given how many silent cycles in a row came
 * before it. The first is `SENSOR_NO_DATA_MS`, each further one doubles, up to
 * `SILENT_LINK_TEARDOWN_MAX_MS`: a peripheral slow to start notifying gets a
 * longer subscription each time, and a dead one is not toggled every few
 * seconds for the whole ride.
 */
export function silentLinkTeardownMs(silentCycles: number): number {
  const doublings = Math.min(Math.max(silentCycles, 0), 6);
  return Math.min(SENSOR_NO_DATA_MS * 2 ** doublings, SILENT_LINK_TEARDOWN_MAX_MS);
}
