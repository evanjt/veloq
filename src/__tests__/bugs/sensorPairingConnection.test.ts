/**
 * Scenario: an athlete pairs a sensor on the Sensors screen with no ride
 * running. Pairing connected every paired sensor, the screen's unmount only
 * stopped the scan, and each connection kept a watchdog interval and a
 * backoff reconnect alive for as long as the app ran.
 *
 * Expected behaviour: pairing connects only the new sensor, leaving the
 * screen disconnects it unless a recording session owns the connections, and
 * a link that drops outside a session is not reconnected.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { SENSOR_NO_DATA_MS } from '@/features/sensors/lib/connectionHealth';
import {
  connectKnownSensors,
  connectPairedSensor,
  disconnectAllSensors,
  releasePairingConnections,
} from '@/features/sensors/lib/sensorManager';

const mockCancelDeviceConnection = jest.fn(async () => undefined);
const mockConnectToDevice = jest.fn();

/** The disconnect callback the manager registered per device id. */
const mockDisconnectCallbacks = new Map<string, () => void>();

const mockDevice = {
  discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
  monitorCharacteristicForService: jest.fn(() => ({ remove: jest.fn() })),
  readCharacteristicForService: jest.fn(async () => ({ value: null })),
};

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: mockCancelDeviceConnection,
    onDeviceDisconnected: jest.fn((id: string, cb: () => void) => {
      mockDisconnectCallbacks.set(id, cb);
      return { remove: jest.fn() };
    }),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

// The manager constructs nothing unless the build carries the native module.
require('react-native').NativeModules.BlePlx = {};

const STRAP = { id: 'strap-1', name: 'Chest strap', kinds: ['heartRate' as const] };
const METER = { id: 'meter-1', name: 'Crank meter', kinds: ['power' as const] };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe('pairing a sensor outside a recording session', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await disconnectAllSensors();
    jest.clearAllMocks();
    mockDisconnectCallbacks.clear();
    mockConnectToDevice.mockResolvedValue(mockDevice);
    useRecordingStore.setState({ status: 'idle' });
    useSensorStore.setState({ knownSensors: [STRAP, METER], connections: {} });
  });

  afterEach(async () => {
    useRecordingStore.setState({ status: 'idle' });
    await disconnectAllSensors();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('connects only the sensor being paired', async () => {
    void connectPairedSensor(METER);
    await settle();

    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);
    expect(mockConnectToDevice).toHaveBeenCalledWith(METER.id, expect.anything());
    expect(useSensorStore.getState().connections[STRAP.id]).toBeUndefined();
  });

  it('disconnects the paired sensor when the screen is left, leaving no timer', async () => {
    void connectPairedSensor(METER);
    await settle();

    await releasePairingConnections();

    expect(mockCancelDeviceConnection).toHaveBeenCalledWith(METER.id);
    expect(useSensorStore.getState().connections[METER.id]).toBeUndefined();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(METER.id)?.();
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(mockConnectToDevice).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not reconnect a pairing link that drops while the screen is open', async () => {
    void connectPairedSensor(METER);
    await settle();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(METER.id)?.();
    jest.advanceTimersByTime(120_000);
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalled();
    expect(useSensorStore.getState().connections[METER.id]).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('drops a silent pairing link instead of reconnecting it', async () => {
    void connectPairedSensor(METER);
    await settle();

    mockConnectToDevice.mockClear();
    jest.advanceTimersByTime(SENSOR_NO_DATA_MS + 120_000);
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalled();
    expect(mockCancelDeviceConnection).toHaveBeenCalledWith(METER.id);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not reconnect a pairing connect that fails', async () => {
    mockConnectToDevice.mockRejectedValueOnce(new Error('Device not found'));
    void connectPairedSensor(METER);
    await settle();

    mockConnectToDevice.mockClear();
    jest.advanceTimersByTime(120_000);
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalled();
    expect(useSensorStore.getState().connections[METER.id]).toBeUndefined();
  });

  it('is a no-op the second time and when nothing was paired', async () => {
    await releasePairingConnections();
    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();

    void connectPairedSensor(METER);
    await settle();
    await releasePairingConnections();
    mockCancelDeviceConnection.mockClear();
    await releasePairingConnections();
    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
  });
});

describe('pairing a sensor while a recording session owns the connections', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await disconnectAllSensors();
    jest.clearAllMocks();
    mockDisconnectCallbacks.clear();
    mockConnectToDevice.mockResolvedValue(mockDevice);
    useSensorStore.setState({ knownSensors: [STRAP, METER], connections: {} });
  });

  afterEach(async () => {
    useRecordingStore.setState({ status: 'idle' });
    await disconnectAllSensors();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('leaves the connection open when a ride is live', async () => {
    useRecordingStore.setState({ status: 'recording' });
    void connectPairedSensor(METER);
    await settle();

    await releasePairingConnections();

    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
    expect(useSensorStore.getState().connections[METER.id]).toBeDefined();
  });

  it('reconnects a link that drops during a live ride', async () => {
    useRecordingStore.setState({ status: 'recording' });
    void connectPairedSensor(METER);
    await settle();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(METER.id)?.();
    jest.advanceTimersByTime(60_000);
    await settle();

    expect(mockConnectToDevice).toHaveBeenCalledWith(METER.id, expect.anything());
  });

  it('leaves the connections open when the recording screen holds them before the start', async () => {
    void connectKnownSensors();
    await settle();

    await releasePairingConnections();
    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(STRAP.id)?.();
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledWith(STRAP.id, expect.anything());
  });
});
