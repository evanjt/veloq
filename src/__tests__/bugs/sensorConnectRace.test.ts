/**
 * Scenario: a ride ends while a sensor connect is still in flight. The connect
 * awaits `connectToDevice` and then service discovery, and only registers
 * itself afterwards, so the teardown finds nothing to disconnect.
 *
 * Expected behaviour: the landing connect sees that it was superseded, drops
 * the device it opened, and registers nothing. Otherwise the sensor stays
 * connected after the ride and the next ride's `connectKnownSensors` returns
 * early against the stale entry.
 */

import { useSensorStore } from '@/features/sensors/store';
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

/** A 72 bpm measurement: flags byte 0, then the 8-bit rate. */
const HEART_RATE_72 = { value: Buffer.from([0x00, 72]).toString('base64') };

/** Connected means a sample has landed, so every case has to deliver one. */
function sendHeartRate(): void {
  deliver?.(null, HEART_RATE_72);
}

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: mockCancelDeviceConnection,
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

const SENSOR = { id: 'hr-1', name: 'Chest strap', kinds: ['heartRate'] as const };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('a sensor disconnected while its connect is in flight', () => {
  beforeEach(async () => {
    // The manager holds its connections in module state, so each case starts
    // from nothing connected rather than from the last one's leftovers.
    await disconnectAllSensors();
    jest.clearAllMocks();
    deliver = null;
    useSensorStore.setState({
      knownSensors: [{ ...SENSOR, kinds: ['heartRate'] }],
      connections: {},
    });
  });

  // The manager runs a no-data watchdog per live connection, so a case that
  // leaves one connected leaves an interval behind.
  afterEach(async () => {
    await disconnectAllSensors();
  });

  it('drops the device the landing connect opened', async () => {
    const held: { land?: () => void } = {};
    mockConnectToDevice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          held.land = () => resolve(mockDevice);
        })
    );

    void connectKnownSensors();
    await settle();
    await disconnectAllSensors();
    held.land?.();
    await settle();

    expect(mockCancelDeviceConnection).toHaveBeenCalledWith(SENSOR.id);
    expect(useSensorStore.getState().connections[SENSOR.id]).toBeUndefined();
  });

  it('lets the next ride connect the same sensor again', async () => {
    const held: { land?: () => void } = {};
    mockConnectToDevice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          held.land = () => resolve(mockDevice);
        })
    );

    void connectKnownSensors();
    await settle();
    await disconnectAllSensors();
    held.land?.();
    await settle();

    mockConnectToDevice.mockClear();
    mockConnectToDevice.mockResolvedValue(mockDevice);
    await connectKnownSensors();
    await settle();

    // The device is reached again, rather than the ride reusing the entry a
    // superseded connect left behind, which reads as connected and is not.
    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);
    sendHeartRate();
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
  });

  it('connects normally when nothing interrupts it', async () => {
    mockConnectToDevice.mockResolvedValue(mockDevice);

    await connectKnownSensors();
    await settle();

    sendHeartRate();
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
  });
});
