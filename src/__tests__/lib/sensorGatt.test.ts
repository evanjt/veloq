/**
 * Tests for the BLE GATT measurement parsers and crank cadence maths.
 * Byte layouts follow the Bluetooth SIG specifications for Heart Rate
 * Measurement (0x2A37), Cycling Power Measurement (0x2A63), CSC Measurement
 * (0x2A5B), and Battery Level (0x2A19).
 */

import {
  parseHeartRate,
  parseCyclingPower,
  parseCsc,
  parseBatteryLevel,
  base64ToBytes,
} from '@/features/sensors/lib/gatt';
import { createCrankCadenceCalculator } from '@/features/sensors/lib/cadence';

describe('parseHeartRate', () => {
  it('parses uint8 heart rate (flags bit0 = 0)', () => {
    expect(parseHeartRate(new Uint8Array([0x00, 72]))).toBe(72);
  });

  it('parses uint16 heart rate (flags bit0 = 1)', () => {
    expect(parseHeartRate(new Uint8Array([0x01, 0x2c, 0x01]))).toBe(300);
  });

  it('ignores extra fields (energy expended, RR intervals)', () => {
    // flags 0x16: uint8 HR + sensor contact + energy expended + RR present
    expect(parseHeartRate(new Uint8Array([0x16, 65, 0x10, 0x00, 0x40, 0x02]))).toBe(65);
  });

  it('rejects truncated payloads', () => {
    expect(parseHeartRate(new Uint8Array([]))).toBeNull();
    expect(parseHeartRate(new Uint8Array([0x00]))).toBeNull();
    expect(parseHeartRate(new Uint8Array([0x01, 0x2c]))).toBeNull();
  });
});

describe('parseCyclingPower', () => {
  it('parses instantaneous power with no optional fields', () => {
    // flags 0x0000, power 250W
    const result = parseCyclingPower(new Uint8Array([0x00, 0x00, 0xfa, 0x00]));
    expect(result).toEqual({ power: 250, crank: null });
  });

  it('parses negative power (sint16)', () => {
    const result = parseCyclingPower(new Uint8Array([0x00, 0x00, 0xff, 0xff]));
    expect(result?.power).toBe(-1);
  });

  it('parses crank revolution data at the correct offset', () => {
    // flags 0x0020 (crank data present), power 200, revs 1000, event time 2048
    const result = parseCyclingPower(
      new Uint8Array([0x20, 0x00, 0xc8, 0x00, 0xe8, 0x03, 0x00, 0x08])
    );
    expect(result?.power).toBe(200);
    expect(result?.crank).toEqual({ cumulativeRevs: 1000, eventTime1024: 2048 });
  });

  it('accounts for preceding optional fields before crank data', () => {
    // flags 0x0025: balance (+1) + torque (+2) + crank data
    const bytes = new Uint8Array([
      0x25, 0x00, 0x96, 0x00, 0x32, 0x10, 0x00, 0x0a, 0x00, 0x00, 0x04,
    ]);
    const result = parseCyclingPower(bytes);
    expect(result?.power).toBe(150);
    expect(result?.crank).toEqual({ cumulativeRevs: 10, eventTime1024: 1024 });
  });

  it('rejects truncated payloads', () => {
    expect(parseCyclingPower(new Uint8Array([0x00, 0x00]))).toBeNull();
  });
});

describe('parseCsc', () => {
  it('parses crank-only measurement', () => {
    // flags 0x02, crank revs 500, event time 1024
    const result = parseCsc(new Uint8Array([0x02, 0xf4, 0x01, 0x00, 0x04]));
    expect(result?.wheel).toBeNull();
    expect(result?.crank).toEqual({ cumulativeRevs: 500, eventTime1024: 1024 });
  });

  it('parses wheel + crank measurement', () => {
    const bytes = new Uint8Array([
      0x03, // both present
      0x10,
      0x27,
      0x00,
      0x00, // wheel revs 10000 (uint32)
      0x00,
      0x08, // wheel event time 2048
      0x64,
      0x00, // crank revs 100
      0x00,
      0x02, // crank event time 512
    ]);
    const result = parseCsc(bytes);
    expect(result?.wheel).toEqual({ cumulativeRevs: 10_000, eventTime1024: 2048 });
    expect(result?.crank).toEqual({ cumulativeRevs: 100, eventTime1024: 512 });
  });

  it('rejects truncated payloads', () => {
    expect(parseCsc(new Uint8Array([]))).toBeNull();
    expect(parseCsc(new Uint8Array([0x01, 0x00]))).toBeNull();
  });
});

describe('parseBatteryLevel', () => {
  it('parses a percentage', () => {
    expect(parseBatteryLevel(new Uint8Array([82]))).toBe(82);
  });

  it('rejects out-of-range and empty values', () => {
    expect(parseBatteryLevel(new Uint8Array([101]))).toBeNull();
    expect(parseBatteryLevel(new Uint8Array([]))).toBeNull();
  });
});

describe('base64ToBytes', () => {
  it('decodes base64 to the raw bytes', () => {
    // [0x00, 72] → "AEg="
    expect(Array.from(base64ToBytes('AEg='))).toEqual([0x00, 72]);
  });
});

describe('createCrankCadenceCalculator', () => {
  it('computes rpm from successive crank samples', () => {
    const calc = createCrankCadenceCalculator();
    expect(calc.update({ cumulativeRevs: 100, eventTime1024: 0 }, 1000)).toBeNull();
    // 3 revs in 2048/1024 = 2s → 90 rpm
    expect(calc.update({ cumulativeRevs: 103, eventTime1024: 2048 }, 3000)).toBe(90);
  });

  it('handles event-time rollover at 2^16', () => {
    const calc = createCrankCadenceCalculator();
    calc.update({ cumulativeRevs: 10, eventTime1024: 65_000 }, 1000);
    // Rolls over: (1512 - 65000) mod 65536 = 2048 → 2s for 3 revs → 90 rpm
    expect(calc.update({ cumulativeRevs: 13, eventTime1024: 1512 }, 3000)).toBe(90);
  });

  it('handles revolution-counter rollover at 2^16', () => {
    const calc = createCrankCadenceCalculator();
    calc.update({ cumulativeRevs: 65_534, eventTime1024: 0 }, 1000);
    expect(calc.update({ cumulativeRevs: 1, eventTime1024: 2048 }, 3000)).toBe(90);
  });

  it('decays to 0 after coasting past the grace window', () => {
    const calc = createCrankCadenceCalculator({ zeroAfterMs: 3000 });
    calc.update({ cumulativeRevs: 100, eventTime1024: 0 }, 1000);
    calc.update({ cumulativeRevs: 103, eventTime1024: 2048 }, 3000);
    // Same sample repeated — no new crank events
    expect(calc.update({ cumulativeRevs: 103, eventTime1024: 2048 }, 4000)).toBeNull();
    expect(calc.update({ cumulativeRevs: 103, eventTime1024: 2048 }, 6500)).toBe(0);
  });

  it('rejects implausible cadence', () => {
    const calc = createCrankCadenceCalculator();
    calc.update({ cumulativeRevs: 0, eventTime1024: 0 }, 1000);
    // 100 revs in 1s = 6000 rpm — noise
    expect(calc.update({ cumulativeRevs: 100, eventTime1024: 1024 }, 2000)).toBeNull();
  });
});
