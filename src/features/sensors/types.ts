/** Sensor capability advertised via its GATT service. */
export type SensorKind = 'heartRate' | 'power' | 'cadence';

/** A sensor the user has paired; persisted so it auto-connects on recording start. */
export interface KnownSensor {
  id: string;
  name: string;
  kinds: SensorKind[];
  /** The metrics the athlete chose this sensor to supply over any other paired sensor. */
  preferredFor?: SensorKind[];
}

/** A device found during a scan, before pairing. */
export interface DiscoveredSensor {
  id: string;
  name: string;
  kinds: SensorKind[];
  rssi: number | null;
}

/**
 * `connected` means a sample has arrived, not that GATT opened. `noData` is a
 * live link that has carried nothing for `SENSOR_NO_DATA_MS`.
 */
export type SensorConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'noData';

export interface SensorConnection {
  status: SensorConnectionStatus;
  name: string;
  kinds: SensorKind[];
  batteryPercent?: number;
  /** Received signal strength in dBm, read while the link is open. */
  rssi?: number;
}

/**
 * Whether sensors can be reached at all, from the permission, the radio and
 * the build. `unknown` until the manager has been constructed and the adapter
 * has answered. `unauthorised` can be asked again, `blocked` only changes in
 * the system settings, and `needsLocation` is Android 7 to 11 with location
 * services off, where a scan finds nothing.
 */
export type SensorAvailability =
  'unknown' | 'unsupported' | 'poweredOff' | 'unauthorised' | 'blocked' | 'needsLocation' | 'ready';
