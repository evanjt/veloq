/** Sensor capability advertised via its GATT service. */
export type SensorKind = 'heartRate' | 'power' | 'cadence';

/** A sensor the user has paired; persisted so it auto-connects on recording start. */
export interface KnownSensor {
  id: string;
  name: string;
  kinds: SensorKind[];
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
}

/** Latest value from a sensor with its arrival time, for sample-and-hold + staleness. */
export interface SensorSample {
  value: number;
  at: number; // Date.now()
}
