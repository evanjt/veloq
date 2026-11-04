/**
 * Scenario: a paired sensor drops mid-ride, or is not in range when the ride
 * starts. The app retried a direct connect with a 10 s timeout on its own
 * timer, so a sensor returning between attempts was found late and each
 * attempt held the radio for ten seconds.
 *
 * Expected behaviour: after a drop, one connect without a timeout is left
 * pending with the platform (`autoConnect` on Android) and nothing else is
 * issued while it waits. A first connect that times out scans for the sensor
 * and pends the connect once it is seen. A deliberate disconnect cancels the
 * pending connect. A connect that fails for another reason keeps the timed
 * backoff.
 */

import { Platform } from 'react-native';
import { BleErrorCode } from 'react-native-ble-plx';

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { connectKnownSensors, disconnectAllSensors } from '@/features/sensors/lib/sensorManager';
import { HEART_RATE_SERVICE } from '@/features/sensors/lib/gatt';
import { sensorLinkEvents } from '@/features/sensors/lib/sensorLinkTrace';

const mockCancelDeviceConnection = jest.fn(async () => undefined);
const mockConnectToDevice = jest.fn();
const mockStopDeviceScan = jest.fn();
const mockStartDeviceScan = jest.fn();

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
    startDeviceScan: mockStartDeviceScan,
    stopDeviceScan: mockStopDeviceScan,
    onDeviceDisconnected: jest.fn((id: string, cb: () => void) => {
      mockDisconnectCallbacks.set(id, cb);
      return { remove: jest.fn() };
    }),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
  })),
}));

require('react-native').NativeModules.BlePlx = {};

const STRAP = { id: 'strap-1', name: 'Chest strap', kinds: ['heartRate' as const] };

const timeoutError = { errorCode: BleErrorCode.OperationTimedOut, message: 'timed out' };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Deliver an advertisement to the scan the manager started last. */
function advertise(id: string): void {
  const callback = mockStartDeviceScan.mock.calls.at(-1)?.[2] as
    ((error: unknown, device: unknown) => void) | undefined;
  callback?.(null, { id, name: 'Chest strap', serviceUUIDs: [HEART_RATE_SERVICE], rssi: -60 });
}

function connectCalls(): [string, Record<string, unknown> | undefined][] {
  return mockConnectToDevice.mock.calls as [string, Record<string, unknown> | undefined][];
}

async function startSession(): Promise<void> {
  await connectKnownSensors();
  await settle();
}

describe.each(['android', 'ios'] as const)('a sensor reconnect on %s', (os) => {
  const originalOs = Platform.OS;

  beforeEach(async () => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    jest.useFakeTimers();
    await disconnectAllSensors();
    jest.clearAllMocks();
    mockDisconnectCallbacks.clear();
    mockConnectToDevice.mockResolvedValue(mockDevice);
    useRecordingStore.setState({ status: 'idle' });
    useSensorStore.setState({ knownSensors: [STRAP], connections: {} });
  });

  afterEach(async () => {
    await disconnectAllSensors();
    jest.clearAllTimers();
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  });

  it('leaves one untimed connect pending after a drop and issues nothing else', async () => {
    await startSession();
    expect(connectCalls()).toHaveLength(1);
    expect(connectCalls()[0]?.[1]).toEqual({ timeout: 10_000 });

    let land: (() => void) | undefined;
    mockConnectToDevice.mockImplementationOnce(
      () => new Promise((resolve) => (land = () => resolve(mockDevice)))
    );
    mockDisconnectCallbacks.get(STRAP.id)?.();
    await settle();

    expect(connectCalls()).toHaveLength(2);
    const options = connectCalls()[1]?.[1] ?? {};
    expect(options).not.toHaveProperty('timeout');
    expect(options).not.toHaveProperty('refreshGatt');
    if (os === 'android') expect(options).toHaveProperty('autoConnect', true);
    expect(useSensorStore.getState().connections[STRAP.id]?.status).toBe('reconnecting');
    expect(sensorLinkEvents().some((e) => e.kind === 'reconnectPending' && e.detail === os)).toBe(
      true
    );

    jest.advanceTimersByTime(120_000);
    await settle();
    expect(connectCalls()).toHaveLength(2);

    mockDevice.monitorCharacteristicForService.mockClear();
    land?.();
    await settle();
    expect(mockDevice.monitorCharacteristicForService).toHaveBeenCalled();
  });

  it('scans after a first connect that times out and pends the connect once the sensor is seen', async () => {
    mockConnectToDevice.mockRejectedValueOnce(timeoutError);
    await startSession();

    expect(connectCalls()).toHaveLength(1);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
    expect(mockStartDeviceScan.mock.calls[0]?.[0]).toContain(HEART_RATE_SERVICE);

    jest.advanceTimersByTime(120_000);
    await settle();
    expect(connectCalls()).toHaveLength(1);

    advertise(STRAP.id);
    await settle();

    expect(connectCalls()).toHaveLength(2);
    expect(connectCalls()[1]?.[1] ?? {}).not.toHaveProperty('timeout');
    expect(mockStopDeviceScan).toHaveBeenCalled();
  });

  it('cancels the pending connect on a deliberate disconnect and registers nothing after it', async () => {
    await startSession();
    let land: (() => void) | undefined;
    mockConnectToDevice.mockImplementationOnce(
      () => new Promise((resolve) => (land = () => resolve(mockDevice)))
    );
    mockDisconnectCallbacks.get(STRAP.id)?.();
    await settle();

    mockCancelDeviceConnection.mockClear();
    mockDevice.monitorCharacteristicForService.mockClear();
    await disconnectAllSensors();
    expect(mockCancelDeviceConnection).toHaveBeenCalledWith(STRAP.id);

    land?.();
    await settle();
    expect(mockDevice.monitorCharacteristicForService).not.toHaveBeenCalled();
    expect(useSensorStore.getState().connections[STRAP.id]).toBeUndefined();
  });

  it('stops looking for an unfound sensor when the session ends', async () => {
    mockConnectToDevice.mockRejectedValueOnce(timeoutError);
    await startSession();
    mockStopDeviceScan.mockClear();

    await disconnectAllSensors();
    expect(mockStopDeviceScan).toHaveBeenCalled();

    advertise(STRAP.id);
    await settle();
    expect(connectCalls()).toHaveLength(1);
  });

  it('keeps the timed backoff for a connect that fails for another reason', async () => {
    mockConnectToDevice.mockRejectedValueOnce({
      errorCode: BleErrorCode.DeviceConnectionFailed,
      message: 'gatt 133',
    });
    await startSession();
    expect(mockStartDeviceScan).not.toHaveBeenCalled();
    expect(connectCalls()).toHaveLength(1);

    jest.advanceTimersByTime(30_000);
    await settle();
    expect(connectCalls()).toHaveLength(2);
    expect(connectCalls()[1]?.[1]).toEqual({ timeout: 10_000 });
  });
});
