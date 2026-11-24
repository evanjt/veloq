/**
 * Scenario: the recording screen is opened on a fresh process without the
 * entry screen (a deep link), so the paired-sensor store has not been read
 * from storage yet.
 *
 * Expected behaviour: the session loads the store before deciding there is
 * nothing to connect, and connects the paired sensor; a screen left while the
 * load was pending connects nothing.
 */

import { useSensorStore } from '@/features/sensors/store';
import { connectPairedSensorsWhenAllowed } from '@/features/sensors/hooks/useSensorSession';
import {
  disconnectAllSensors,
  holdSensors,
  releaseSensors,
} from '@/features/sensors/lib/sensorManager';

const mockConnectToDevice = jest.fn();
const mockGetSetting = jest.fn();

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

jest.mock('@/features/sensors/lib/sensorManager', () => ({
  ...jest.requireActual('@/features/sensors/lib/sensorManager'),
  requestBlePermissions: jest.fn(async () => 'granted'),
}));

const mockDevice = {
  discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
  monitorCharacteristicForService: jest.fn(() => ({ remove: jest.fn() })),
  readCharacteristicForService: jest.fn(async () => ({ value: null })),
  readRSSI: jest.fn(async () => ({ rssi: -58 })),
};

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: jest.fn(async () => undefined),
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
  })),
}));

require('react-native').NativeModules.BlePlx = {};

const STRAP = { id: 'strap-1', name: 'Chest strap', kinds: ['heartRate'] };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(async () => {
  jest.useFakeTimers();
  await disconnectAllSensors();
  jest.clearAllMocks();
  mockConnectToDevice.mockResolvedValue(mockDevice);
  mockGetSetting.mockResolvedValue(JSON.stringify([STRAP]));
  useSensorStore.setState({ knownSensors: [], connections: {}, isLoaded: false });
});

afterEach(async () => {
  await disconnectAllSensors();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('the recording screen opened with the sensor store unloaded', () => {
  it('loads the paired sensors and connects them once', async () => {
    holdSensors('session');
    connectPairedSensorsWhenAllowed('session');
    await settle();

    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);
    expect(mockConnectToDevice).toHaveBeenCalledWith(STRAP.id, expect.anything());
  });

  it('connects nothing when the screen is left while the store loads', async () => {
    holdSensors('session');
    connectPairedSensorsWhenAllowed('session');
    releaseSensors('session', { immediate: true });
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalled();
  });

  it('connects nothing when no sensor is paired', async () => {
    mockGetSetting.mockResolvedValue(null);
    holdSensors('session');
    connectPairedSensorsWhenAllowed('session');
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalled();
  });
});
