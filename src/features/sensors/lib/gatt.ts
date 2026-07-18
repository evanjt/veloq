/**
 * Bluetooth GATT service/characteristic UUIDs and measurement parsers for the
 * standard fitness profiles. Parsers are pure functions over raw bytes so they
 * are unit-testable without any BLE stack.
 *
 * Profiles (Bluetooth SIG assigned numbers):
 * - Heart Rate Service 0x180D, Heart Rate Measurement 0x2A37
 * - Cycling Power Service 0x1818, Cycling Power Measurement 0x2A63
 * - Cycling Speed and Cadence Service 0x1816, CSC Measurement 0x2A5B
 * - Battery Service 0x180F, Battery Level 0x2A19
 */

export const HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
export const CYCLING_POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb';
export const CYCLING_POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb';
export const CSC_SERVICE = '00001816-0000-1000-8000-00805f9b34fb';
export const CSC_MEASUREMENT = '00002a5b-0000-1000-8000-00805f9b34fb';
export const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) +
    bytes[offset + 3] * 0x1000000
  );
}

function sint16le(bytes: Uint8Array, offset: number): number {
  const value = uint16le(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

/** Heart Rate Measurement (0x2A37): flags bit0 selects uint8 vs uint16 HR. */
export function parseHeartRate(bytes: Uint8Array): number | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  const is16Bit = (flags & 0x01) !== 0;
  if (is16Bit) {
    if (bytes.length < 3) return null;
    return uint16le(bytes, 1);
  }
  return bytes[1];
}

export interface CrankData {
  cumulativeRevs: number;
  /** Last crank event time in 1/1024 s units, wraps at 2^16. */
  eventTime1024: number;
}

export interface CyclingPowerMeasurement {
  /** Instantaneous power in watts. */
  power: number;
  crank: CrankData | null;
}

/**
 * Cycling Power Measurement (0x2A63): uint16 flags, sint16 instantaneous
 * power, then optional fields in flag order. Only the fields preceding crank
 * revolution data affect its offset.
 */
export function parseCyclingPower(bytes: Uint8Array): CyclingPowerMeasurement | null {
  if (bytes.length < 4) return null;
  const flags = uint16le(bytes, 0);
  const power = sint16le(bytes, 2);

  let offset = 4;
  if (flags & 0x0001) offset += 1; // pedal power balance
  if (flags & 0x0004) offset += 2; // accumulated torque
  if (flags & 0x0010) offset += 6; // wheel revolution data (uint32 revs + uint16 time)

  let crank: CrankData | null = null;
  if (flags & 0x0020) {
    if (bytes.length < offset + 4) return { power, crank: null };
    crank = {
      cumulativeRevs: uint16le(bytes, offset),
      eventTime1024: uint16le(bytes, offset + 2),
    };
  }

  return { power, crank };
}

export interface CscMeasurement {
  wheel: { cumulativeRevs: number; eventTime1024: number } | null;
  crank: CrankData | null;
}

/** CSC Measurement (0x2A5B): flags bit0 = wheel data present, bit1 = crank data present. */
export function parseCsc(bytes: Uint8Array): CscMeasurement | null {
  if (bytes.length < 1) return null;
  const flags = bytes[0];
  let offset = 1;

  let wheel: CscMeasurement['wheel'] = null;
  if (flags & 0x01) {
    if (bytes.length < offset + 6) return null;
    wheel = {
      cumulativeRevs: uint32le(bytes, offset),
      eventTime1024: uint16le(bytes, offset + 4),
    };
    offset += 6;
  }

  let crank: CrankData | null = null;
  if (flags & 0x02) {
    if (bytes.length < offset + 4) return { wheel, crank: null };
    crank = {
      cumulativeRevs: uint16le(bytes, offset),
      eventTime1024: uint16le(bytes, offset + 2),
    };
  }

  return { wheel, crank };
}

/** Battery Level (0x2A19): single uint8 percent. */
export function parseBatteryLevel(bytes: Uint8Array): number | null {
  if (bytes.length < 1) return null;
  const value = bytes[0];
  return value >= 0 && value <= 100 ? value : null;
}

/** Decode a base64 characteristic value (ble-plx delivers base64) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
