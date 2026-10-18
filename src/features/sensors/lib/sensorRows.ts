import type {
  DiscoveredSensor,
  KnownSensor,
  SensorConnection,
  SensorConnectionStatus,
  SensorKind,
} from '../types';
import { metricsSuppliedBy } from './sensorSource';

/** Bars of signal, from one for a sensor at the edge of range to three for one beside the phone. */
export type SignalLevel = 1 | 2 | 3;

/**
 * The bars a received signal strength reads as, or null when the scan gave
 * none. A strap on the chest reads about -50 dBm, and one across the room
 * below -80.
 */
export function signalLevel(rssi: number | null): SignalLevel | null {
  if (rssi == null || !Number.isFinite(rssi)) return null;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

/**
 * Nearest first, so the sensor being worn is the top row. A sensor with no
 * signal reading goes last, and ties keep the order they were found in.
 */
export function nearestFirst(sensors: DiscoveredSensor[]): DiscoveredSensor[] {
  const strength = (s: DiscoveredSensor) =>
    s.rssi != null && Number.isFinite(s.rssi) ? s.rssi : Number.NEGATIVE_INFINITY;
  return [...sensors].sort((a, b) => {
    const sa = strength(a);
    const sb = strength(b);
    return sa === sb ? 0 : sb > sa ? 1 : -1;
  });
}

/**
 * A sensor that advertises no name is stored under its device id, a MAC
 * address on Android and a UUID on iOS, which is no name to show.
 */
export function isUnnamed(sensor: { id: string; name: string }): boolean {
  const name = sensor.name.trim();
  return name.length === 0 || name === sensor.id;
}

/** The last four characters of the device id, enough to tell two of one model apart. */
export function shortSensorId(id: string): string {
  return id
    .replace(/[^0-9a-z]/gi, '')
    .slice(-4)
    .toUpperCase();
}

/**
 * The label each row shows, with the short device id added to any label
 * another row shares, so two straps of one model can be told apart.
 */
export function distinctLabels(rows: { id: string; label: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  return new Map(
    rows.map((row) => [
      row.id,
      (counts.get(row.label) ?? 0) > 1 ? `${row.label} · ${shortSensorId(row.id)}` : row.label,
    ])
  );
}

/** A paired sensor's state on the record entry screen, `off` when it has no link. */
export type SessionSensorState = SensorConnectionStatus | 'off';

export interface SessionSensorRow {
  id: string;
  sensor: KnownSensor;
  state: SessionSensorState;
  /** The metrics this sensor is the recorded source of, each with its last value. */
  live: { kind: SensorKind; value: number }[];
  batteryPercent: number | null;
  signal: SignalLevel | null;
  /** The last signal reading in dBm, null before one. */
  rssi: number | null;
}

const RECORDING_KIND = { heartRate: 'heartrate', power: 'power', cadence: 'cadence' } as const;

/**
 * One row per paired sensor, in pairing order, from the sensor store and the
 * recording store's live samples. A value shows only while the link is
 * carrying data and only on the sensor the metric is recorded from, so the
 * number beside a strap is the one the ride would take.
 */
export function sessionSensorRows({
  knownSensors,
  connections,
  activeSources,
  suppliedKinds,
  latestSensor,
}: {
  knownSensors: KnownSensor[];
  connections: Record<string, SensorConnection>;
  activeSources: Partial<Record<SensorKind, string>>;
  suppliedKinds: Record<string, SensorKind[]>;
  latestSensor: Record<'heartrate' | 'power' | 'cadence', { value: number } | null>;
}): SessionSensorRow[] {
  return knownSensors.map((sensor) => {
    const connection = connections[sensor.id];
    const state: SessionSensorState = connection?.status ?? 'off';
    const live =
      state === 'connected'
        ? metricsSuppliedBy(sensor, suppliedKinds[sensor.id]).flatMap((kind) => {
            const sample = latestSensor[RECORDING_KIND[kind]];
            return activeSources[kind] === sensor.id && sample
              ? [{ kind, value: sample.value }]
              : [];
          })
        : [];
    return {
      id: sensor.id,
      sensor,
      state,
      live,
      batteryPercent: connection?.batteryPercent ?? null,
      signal: connection ? signalLevel(connection.rssi ?? null) : null,
      rssi: connection?.rssi ?? null,
    };
  });
}
