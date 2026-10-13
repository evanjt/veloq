import type { DiscoveredSensor } from '../types';

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
