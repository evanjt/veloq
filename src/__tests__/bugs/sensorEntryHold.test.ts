/**
 * Scenario: the athlete opens the record entry screen with paired sensors.
 * Nothing connected them until Start, so the screen could not say whether a
 * strap was sending, and a sensor could not be dropped before the ride.
 *
 * Expected behaviour: the entry screen holds the paired sensors connected,
 * the recording screen takes the hold over without a reconnect, leaving
 * without starting disconnects them, and a sensor the athlete disconnects
 * stays off for the rest of that session.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  SENSOR_RELEASE_GRACE_MS,
  connectKnownSensors,
  connectSensorForSession,
  disconnectAllSensors,
  dropSensorForSession,
  holdSensors,
  releaseSensors,
} from '@/features/sensors/lib/sensorManager';

const mockCancelDeviceConnection = jest.fn(async (_id: string) => undefined);
const mockConnectToDevice = jest.fn();
const mockDisconnectCallbacks = new Map<string, () => void>();

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
    cancelDeviceConnection: mockCancelDeviceConnection,
    onDeviceDisconnected: jest.fn((id: string, cb: () => void) => {
      mockDisconnectCallbacks.set(id, cb);
      return { remove: jest.fn() };
    }),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

require('react-native').NativeModules.BlePlx = {};

const STRAP = { id: 'strap-1', name: 'Chest strap', kinds: ['heartRate' as const] };
const METER = { id: 'meter-1', name: 'Crank meter', kinds: ['power' as const] };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const connectedIds = () => mockConnectToDevice.mock.calls.map(([id]) => id as string);
const cancelledIds = () => mockCancelDeviceConnection.mock.calls.map(([id]) => id);

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

async function openEntry(): Promise<void> {
  holdSensors('entry');
  void connectKnownSensors();
  await settle();
}

describe('the record entry screen holding the paired sensors', () => {
  it('connects every paired sensor before Start', async () => {
    await openEntry();

    expect(connectedIds().sort()).toEqual([METER.id, STRAP.id]);
    expect(useSensorStore.getState().connections[STRAP.id]).toBeDefined();
  });

  it('disconnects them when the screen is left without starting, leaving no timer', async () => {
    await openEntry();

    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS);
    await settle();

    expect(cancelledIds().sort()).toEqual([METER.id, STRAP.id]);
    expect(useSensorStore.getState().connections).toEqual({});
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not reconnect a link that drops after the screen is left', async () => {
    await openEntry();
    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS);
    await settle();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(STRAP.id)?.();
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(mockConnectToDevice).not.toHaveBeenCalled();
  });

  it('hands the connections to the recording screen when it takes the hold after the entry lets go', async () => {
    await openEntry();
    mockConnectToDevice.mockClear();

    releaseSensors('entry');
    holdSensors('session');
    void connectKnownSensors();
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS * 2);
    await settle();

    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
    expect(mockConnectToDevice).not.toHaveBeenCalled();
    expect(Object.keys(useSensorStore.getState().connections).sort()).toEqual([METER.id, STRAP.id]);
  });

  it('hands the connections over when the recording screen holds them before the entry lets go', async () => {
    await openEntry();

    holdSensors('session');
    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS * 2);
    await settle();

    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
  });

  it('keeps them while a ride is live, even with no screen holding them', async () => {
    await openEntry();
    useRecordingStore.setState({ status: 'recording' });

    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS * 2);
    await settle();

    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
  });

  it('reconnects a link that drops while the entry screen is open', async () => {
    await openEntry();

    mockConnectToDevice.mockClear();
    mockDisconnectCallbacks.get(STRAP.id)?.();
    jest.advanceTimersByTime(60_000);
    await settle();

    expect(mockConnectToDevice).toHaveBeenCalledWith(STRAP.id, expect.anything());
  });

  it('is a no-op to let go of a hold that was never taken', async () => {
    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS);
    await settle();

    expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('disconnecting one sensor for the session', () => {
  it('disconnects it and the recording screen does not connect it again', async () => {
    await openEntry();

    await dropSensorForSession(STRAP.id);
    expect(cancelledIds()).toEqual([STRAP.id]);
    expect(useSensorStore.getState().connections[STRAP.id]).toBeUndefined();

    mockConnectToDevice.mockClear();
    holdSensors('session');
    releaseSensors('entry');
    void connectKnownSensors();
    await settle();

    expect(mockConnectToDevice).not.toHaveBeenCalledWith(STRAP.id, expect.anything());
    expect(useSensorStore.getState().connections[STRAP.id]).toBeUndefined();
  });

  it('connects it again when the athlete asks for it back', async () => {
    await openEntry();
    await dropSensorForSession(STRAP.id);
    mockConnectToDevice.mockClear();

    await connectSensorForSession(STRAP.id);
    await settle();

    expect(connectedIds()).toEqual([STRAP.id]);
    expect(useSensorStore.getState().connections[STRAP.id]).toBeDefined();
  });

  it('is forgotten when the session ends, so the next one connects it', async () => {
    await openEntry();
    await dropSensorForSession(STRAP.id);

    await disconnectAllSensors();
    mockConnectToDevice.mockClear();
    await openEntry();

    expect(connectedIds().sort()).toEqual([METER.id, STRAP.id]);
  });

  it('is forgotten when the entry screen is left without starting', async () => {
    await openEntry();
    await dropSensorForSession(STRAP.id);
    releaseSensors('entry');
    jest.advanceTimersByTime(SENSOR_RELEASE_GRACE_MS);
    await settle();

    mockConnectToDevice.mockClear();
    await openEntry();

    expect(connectedIds().sort()).toEqual([METER.id, STRAP.id]);
  });
});

describe('the signal of a connected sensor', () => {
  it('is read while the link is open and written beside its connection', async () => {
    await openEntry();

    jest.advanceTimersByTime(2_000);
    await settle();

    expect(useSensorStore.getState().connections[STRAP.id]?.rssi).toBe(-58);
  });

  it('leaves the connection standing when the read fails', async () => {
    mockDevice.readRSSI.mockRejectedValue(new Error('Device not connected'));
    await openEntry();

    jest.advanceTimersByTime(2_000);
    await settle();

    expect(useSensorStore.getState().connections[STRAP.id]).toBeDefined();
    expect(useSensorStore.getState().connections[STRAP.id]?.rssi).toBeUndefined();
    mockDevice.readRSSI.mockResolvedValue({ rssi: -58 });
  });
});

describe('the recording screen letting go while no ride is under way', () => {
  it('disconnects at once, since no screen takes the sensors over from it', async () => {
    holdSensors('session');
    void connectKnownSensors();
    await settle();

    releaseSensors('session', { immediate: true });
    await settle();

    expect(cancelledIds().sort()).toEqual([METER.id, STRAP.id]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
