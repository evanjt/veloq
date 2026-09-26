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
 */
export function sensorConnectionHealth({
  attempt,
  subscribedAt,
  lastSampleAt,
  now,
}: SensorLinkState): SensorConnectionStatus {
  const pending = attempt === 'first' ? 'connecting' : 'reconnecting';
  if (subscribedAt === null) return pending;

  const since = lastSampleAt ?? subscribedAt;
  if (now - since >= SENSOR_NO_DATA_MS) return 'noData';
  return lastSampleAt === null ? pending : 'connected';
}
