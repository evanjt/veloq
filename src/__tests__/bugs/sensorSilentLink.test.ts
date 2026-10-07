/**
 * Scenario: a strap pairs and connects, the notification enable fails or the
 * peripheral stops sending, and nothing ever arrives. The row said connected
 * from the moment the monitors were registered, and the monitor's own error
 * was returned into an `if (error) return`.
 *
 * Expected behaviour: connected means a sample has landed. A link that has
 * sent nothing for the watchdog interval reads as no data, is logged, and is
 * torn down for a reconnect.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { SENSOR_NO_DATA_MS, sensorConnectionHealth } from '@/features/sensors/lib/connectionHealth';
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
    stopDeviceScan: jest.fn(),
  })),
}));

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
});
