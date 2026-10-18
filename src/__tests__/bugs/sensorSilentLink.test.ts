/**
 * Scenario: a strap pairs and connects, the notification enable fails or the
 * peripheral stops sending, and nothing ever arrives. The row said connected
 * from the moment the monitors were registered, and the monitor's own error
 * was returned into an `if (error) return`.
 *
 * Expected behaviour: connected means a sample has landed. A link that has
 * sent nothing for the watchdog interval reads as no data, is logged, and is
 * torn down for a reconnect. A link that stays silent through the reconnects is
 * left subscribed longer each time and reconnected later each time, rather than
 * toggled on a fixed cycle for the whole ride.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  SENSOR_NO_DATA_MS,
  SILENT_LINK_TEARDOWN_MAX_MS,
  sensorConnectionHealth,
  silentLinkTeardownMs,
} from '@/features/sensors/lib/connectionHealth';
import { connectKnownSensors, disconnectAllSensors } from '@/features/sensors/lib/sensorManager';

const mockCancelDeviceConnection = jest.fn(async () => undefined);
const mockConnectToDevice = jest.fn();

/** The monitor callback the manager registered, so a test can deliver to it. */
let deliver: ((error: unknown, characteristic: unknown) => void) | null = null;

const mockDevice = {
  discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
  monitorCharacteristicForService: jest.fn(
    (_service: string, _characteristic: string, cb: (e: unknown, c: unknown) => void) => {
      deliver = cb;
      return { remove: jest.fn() };
    }
  ),
  readCharacteristicForService: jest.fn(async () => ({ value: null })),
};

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: mockCancelDeviceConnection,
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

// The manager constructs nothing unless the build carries the native module.
require('react-native').NativeModules.BlePlx = {};

const SENSOR = { id: 'hr-1', name: 'Chest strap', kinds: ['heartRate' as const] };

/** A 72 bpm measurement: flags byte 0, then the 8-bit rate. */
const HEART_RATE_72 = { value: Buffer.from([0x00, 72]).toString('base64') };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('sensorConnectionHealth', () => {
  const base = { attempt: 'first' as const, subscribedAt: null, lastSampleAt: null, now: 1000 };

  it('is connecting until the monitors are registered', () => {
    expect(sensorConnectionHealth(base)).toBe('connecting');
    expect(sensorConnectionHealth({ ...base, attempt: 'retry' })).toBe('reconnecting');
  });

  it('stays connecting while a subscribed link has sent nothing yet', () => {
    expect(sensorConnectionHealth({ ...base, subscribedAt: 1000, now: 1000 })).toBe('connecting');
    expect(
      sensorConnectionHealth({ ...base, attempt: 'retry', subscribedAt: 1000, now: 1000 })
    ).toBe('reconnecting');
  });

  it('is connected once a sample lands', () => {
    expect(
      sensorConnectionHealth({ ...base, subscribedAt: 1000, lastSampleAt: 1200, now: 1300 })
    ).toBe('connected');
  });

  it('is no data when nothing has arrived for the watchdog interval', () => {
    expect(
      sensorConnectionHealth({ ...base, subscribedAt: 1000, now: 1000 + SENSOR_NO_DATA_MS })
    ).toBe('noData');
  });

  it('stays no data through a reconnect after a silent cycle until a sample lands', () => {
    const silent = { ...base, attempt: 'retry' as const, silentCycles: 1 };
    expect(sensorConnectionHealth(silent)).toBe('noData');
    expect(sensorConnectionHealth({ ...silent, subscribedAt: 1000, now: 1000 })).toBe('noData');
    expect(
      sensorConnectionHealth({
        ...silent,
        silentCycles: 0,
        subscribedAt: 1000,
        lastSampleAt: 1200,
        now: 1300,
      })
    ).toBe('connected');
  });

  it('is no data when a sensor that was sending goes quiet', () => {
    expect(
      sensorConnectionHealth({
        ...base,
        subscribedAt: 1000,
        lastSampleAt: 2000,
        now: 2000 + SENSOR_NO_DATA_MS,
      })
    ).toBe('noData');
  });
});

describe('silentLinkTeardownMs', () => {
  it('tears the first silent cycle down at the no data interval', () => {
    expect(silentLinkTeardownMs(0)).toBe(SENSOR_NO_DATA_MS);
  });

  it('doubles with each further silent cycle', () => {
    expect(silentLinkTeardownMs(1)).toBe(2 * SENSOR_NO_DATA_MS);
    expect(silentLinkTeardownMs(2)).toBe(4 * SENSOR_NO_DATA_MS);
  });

  it('never exceeds the cap', () => {
    expect(SILENT_LINK_TEARDOWN_MAX_MS).toBe(60_000);
    for (const cycles of [3, 4, 10, 100, 2000]) {
      expect(silentLinkTeardownMs(cycles)).toBe(SILENT_LINK_TEARDOWN_MAX_MS);
    }
  });

  it('reads a negative count as the first cycle', () => {
    expect(silentLinkTeardownMs(-1)).toBe(SENSOR_NO_DATA_MS);
  });
});

describe('a sensor that connects and sends nothing', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await disconnectAllSensors();
    jest.clearAllMocks();
    deliver = null;
    mockConnectToDevice.mockResolvedValue(mockDevice);
    useSensorStore.setState({ knownSensors: [SENSOR], connections: {} });
  });

  afterEach(async () => {
    await disconnectAllSensors();
    jest.useRealTimers();
  });

  it('does not read connected until the first sample arrives', async () => {
    void connectKnownSensors();
    await settle();

    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connecting');

    deliver?.(null, HEART_RATE_72);
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
    expect(useRecordingStore.getState().latestSensor.heartrate?.value).toBe(72);
  });

  it('reads no data and reconnects once the watchdog interval passes', async () => {
    void connectKnownSensors();
    await settle();

    mockConnectToDevice.mockClear();
    jest.advanceTimersByTime(SENSOR_NO_DATA_MS + 1000);
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('noData');

    // The reconnect is the recovery every BLE central falls back to.
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledWith(SENSOR.id, expect.anything());
  });

  it('logs the monitor error instead of dropping it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    void connectKnownSensors();
    await settle();

    deliver?.({ message: 'Characteristic notification failed' }, null);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Sensors'),
      expect.stringContaining('Chest strap'),
      expect.stringContaining('Characteristic notification failed')
    );
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).not.toBe('connected');
    warn.mockRestore();
  });

  it('backs off further on each silent cycle and starts again once a sample lands', async () => {
    const connects: number[] = [];
    mockConnectToDevice.mockImplementation(async () => {
      connects.push(Date.now());
      return mockDevice;
    });
    const start = Date.now();
    const statuses: { at: number; status: string | undefined }[] = [];
    const runFor = async (ms: number) => {
      for (let t = 0; t < ms; t += 500) {
        jest.advanceTimersByTime(500);
        await settle();
        statuses.push({
          at: Date.now() - start,
          status: useSensorStore.getState().connections[SENSOR.id]?.status,
        });
      }
    };

    void connectKnownSensors();
    await settle();
    while (connects.length < 5 && Date.now() - start < 400_000) await runFor(500);
    expect(connects).toHaveLength(5);

    const gaps = connects.slice(1).map((at, i) => at - connects[i]);
    for (let i = 0; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThanOrEqual(silentLinkTeardownMs(i));
      if (i > 0) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    }
    for (const { at, status } of statuses) {
      if (at >= SENSOR_NO_DATA_MS) expect({ at, status }).toEqual({ at, status: 'noData' });
    }

    await runFor(1000);
    deliver?.(null, HEART_RATE_72);
    const sampleAt = Date.now();
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');

    while (connects.length < 6 && Date.now() - sampleAt < 400_000) await runFor(500);
    expect(connects).toHaveLength(6);
    expect(connects[5] - sampleAt).toBeGreaterThanOrEqual(silentLinkTeardownMs(0));
    expect(connects[5] - sampleAt).toBeLessThan(silentLinkTeardownMs(1));
  });
});
