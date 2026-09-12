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

const mockDevice = {
  discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
  monitorCharacteristicForService: jest.fn(() => ({ remove: jest.fn() })),
  readCharacteristicForService: jest.fn(async () => ({ value: null })),
};

jest.mock('react-native-ble-plx', () => ({
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
    useSensorStore.setState({
      knownSensors: [{ ...SENSOR, kinds: ['heartRate'] }],
      connections: {},
    });
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
    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
  });

  it('connects normally when nothing interrupts it', async () => {
    mockConnectToDevice.mockResolvedValue(mockDevice);

    await connectKnownSensors();
    await settle();

    expect(useSensorStore.getState().connections[SENSOR.id]?.status).toBe('connected');
  });
});
