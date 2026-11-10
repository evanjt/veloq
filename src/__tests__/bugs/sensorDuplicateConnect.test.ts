/**
 * Scenario: the entry screen's connect for a strap is still in flight when the
 * recording screen mounts and asks for the same strap again.
 *
 * Expected behaviour: the second request joins the pending connect. One
 * `connectToDevice` call is made, since a second connect to a device that is
 * connecting makes the platform cancel the first.
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
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
  })),
}));

// The manager constructs nothing unless the build carries the native module.
require('react-native').NativeModules.BlePlx = {};

const SENSOR = { id: 'hr-1', name: 'Chest strap', kinds: ['heartRate'] as const };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('a second connect request for a sensor that is already connecting', () => {
  beforeEach(async () => {
    await disconnectAllSensors();
    jest.clearAllMocks();
    deliver = null;
    useSensorStore.setState({
      knownSensors: [{ ...SENSOR, kinds: ['heartRate'] }],
      connections: {},
    });
  });

  afterEach(async () => {
    await disconnectAllSensors();
  });

  it('makes one connect call and leaves one live link', async () => {
    const held: { land?: () => void } = {};
    mockConnectToDevice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          held.land = () => resolve(mockDevice);
        })
    );

    void connectKnownSensors();
    await settle();
    void connectKnownSensors();
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);

    held.land?.();
    await settle();
    sendHeartRate();
    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
    expect(mockDevice.monitorCharacteristicForService).toHaveBeenCalledTimes(1);
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
  });

  it('connects again after the first connect has failed', async () => {
    mockConnectToDevice.mockRejectedValueOnce(new Error('refused'));
    mockConnectToDevice.mockResolvedValue(mockDevice);

    void connectKnownSensors();
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);
    void connectKnownSensors();
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledTimes(2);
  });
});
