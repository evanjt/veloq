/**
 * Scenario: Bluetooth is off, refused or unusable. A scan error only logged and
 * stopped the spinner, a refused permission returned a bare false that every
 * caller dropped, Android 7 to 11 never asked for the location grant a scan
 * needs there, a failed connect retried for the whole ride under
 * "Reconnecting…", and an empty scan never ended.
 *
 * Expected behaviour: one availability value in the sensor store, written from
 * the permission outcome, the adapter state and the scan and connect errors. A
 * connect that cannot reach the radio waits for it to come back rather than
 * retrying, the recording screen says why, and a scan ends after its window.
 */

import { BleErrorCode } from 'react-native-ble-plx';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockRequestLocation = jest.fn();
const mockReadLocation = jest.fn();
const mockLocationServicesOn = jest.fn();
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: () => mockRequestLocation(),
  getForegroundPermissionsAsync: () => mockReadLocation(),
  hasServicesEnabledAsync: () => mockLocationServicesOn(),
}));

/** Every adapter state listener the manager registered, so a case can drive the radio. */
let mockStateListeners: ((state: string) => void)[] = [];
let mockScanCallback: ((error: unknown, device: unknown) => void) | null = null;
const mockStartDeviceScan = jest.fn(
  (_uuids: unknown, _options: unknown, cb: typeof mockScanCallback) => {
    mockScanCallback = cb;
  }
);
const mockStopDeviceScan = jest.fn();
const mockConnectToDevice = jest.fn();
const mockConstructed = jest.fn();

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => {
    mockConstructed();
    return {
      onStateChange: jest.fn((listener: (state: string) => void) => {
        mockStateListeners.push(listener);
        return { remove: jest.fn() };
      }),
      state: jest.fn(async () => 'Unknown'),
      startDeviceScan: mockStartDeviceScan,
      stopDeviceScan: mockStopDeviceScan,
      connectToDevice: mockConnectToDevice,
      cancelDeviceConnection: jest.fn(async () => undefined),
      onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    };
  }),
}));

type Manager = typeof import('@/features/sensors/lib/sensorManager');
type Store = typeof import('@/features/sensors/store');
type Issue = typeof import('@/features/sensors/hooks/useSensorIssue');

let manager: Manager;
let store: Store['useSensorStore'];
let useSensorIssue: Issue['useSensorIssue'];
/** Loaded beside the hook, so both see the same fresh copy of React. */
let renderHook: (typeof import('@testing-library/react-native/pure'))['renderHook'];

const SENSOR = { id: 'hr-1', name: 'Chest strap', kinds: ['heartRate' as const] };

function bleError(errorCode: number): Error & { errorCode: number } {
  return Object.assign(new Error(`ble error ${errorCode}`), { errorCode });
}

function emitAdapter(state: string): void {
  for (const listener of mockStateListeners) listener(state);
}

/** The fresh copy of react-native the manager loaded, which is the one whose platform counts. */
let rn: typeof import('react-native');

function setPlatform(os: 'ios' | 'android', version: number): void {
  Object.defineProperty(rn.Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(rn.Platform, 'Version', { value: version, configurable: true });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Start a scan and answer the adapter read it waits on with the radio on. */
async function scanWithRadioOn(): Promise<void> {
  const scan = manager.startScan();
  await settle();
  emitAdapter('PoweredOn');
  await scan;
}

beforeEach(() => {
  // The manager keeps the radio, the grant and its connections in module
  // state, so every case loads it fresh.
  jest.resetModules();
  jest.clearAllMocks();
  mockStateListeners = [];
  mockScanCallback = null;
  manager = require('@/features/sensors/lib/sensorManager');
  store = require('@/features/sensors/store').useSensorStore;
  useSensorIssue = require('@/features/sensors/hooks/useSensorIssue').useSensorIssue;
  renderHook = require('@testing-library/react-native/pure').renderHook;
  rn = require('react-native');
  rn.NativeModules.BlePlx = {};
  setPlatform('ios', 17);
});

afterEach(async () => {
  await manager.disconnectAllSensors();
  manager.stopScan();
  jest.useRealTimers();
});

describe('availability without the manager', () => {
  it('reports the module as present without constructing the manager', () => {
    expect(manager.isBleAvailable()).toBe(true);
    expect(mockConstructed).not.toHaveBeenCalled();
  });

  it('reports a build with no Bluetooth module as unavailable', () => {
    delete rn.NativeModules.BlePlx;
    expect(manager.isBleAvailable()).toBe(false);
  });

  it('stops a scan that never started without constructing the manager', () => {
    manager.stopScan();
    expect(mockConstructed).not.toHaveBeenCalled();
  });

  it('starts unknown until something is read', () => {
    expect(store.getState().availability).toBe('unknown');
  });
});

describe('the scan', () => {
  it('reads Bluetooth off from the scan error', async () => {
    await scanWithRadioOn();
    mockScanCallback?.(bleError(BleErrorCode.BluetoothPoweredOff), null);

    expect(store.getState().availability).toBe('poweredOff');
    expect(store.getState().scanning).toBe(false);
  });

  it('reads a refusal from the scan error as blocked on iOS, which never asks twice', async () => {
    await scanWithRadioOn();
    mockScanCallback?.(bleError(BleErrorCode.BluetoothUnauthorized), null);

    expect(store.getState().availability).toBe('blocked');
  });

  it('does not start scanning while the adapter reports it is off', async () => {
    const scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOff');
    await scan;

    expect(mockStartDeviceScan).not.toHaveBeenCalled();
    expect(store.getState().availability).toBe('poweredOff');
    expect(store.getState().scanning).toBe(false);
  });

  it('scans once the adapter settles on', async () => {
    const scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOn');
    await scan;

    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
    expect(store.getState().availability).toBe('ready');
  });

  it('follows the adapter after the scan, both ways', async () => {
    await scanWithRadioOn();
    emitAdapter('PoweredOff');
    expect(store.getState().availability).toBe('poweredOff');
    emitAdapter('PoweredOn');
    expect(store.getState().availability).toBe('ready');
  });

  it('ends an empty scan after its window and says it found nothing', async () => {
    jest.useFakeTimers();
    const scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOn');
    await scan;
    expect(store.getState().scanning).toBe(true);
    expect(store.getState().scanFinished).toBe(false);

    jest.advanceTimersByTime(manager.SCAN_WINDOW_MS);

    expect(mockStopDeviceScan).toHaveBeenCalled();
    expect(store.getState().scanning).toBe(false);
    expect(store.getState().scanFinished).toBe(true);
  });

  it('does not report a scan the athlete stopped as finished', async () => {
    jest.useFakeTimers();
    const scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOn');
    await scan;
    manager.stopScan();
    jest.advanceTimersByTime(manager.SCAN_WINDOW_MS);

    expect(store.getState().scanFinished).toBe(false);
  });

  it('clears the finished flag when the next scan starts', async () => {
    jest.useFakeTimers();
    let scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOn');
    await scan;
    jest.advanceTimersByTime(manager.SCAN_WINDOW_MS);
    expect(store.getState().scanFinished).toBe(true);

    scan = manager.startScan();
    await scan;
    expect(store.getState().scanFinished).toBe(false);
    expect(store.getState().scanning).toBe(true);
  });
});

const NEVER = 'never_ask_again';
const DENIED = 'denied';
const GRANTED = 'granted';

function androidAnswers(scan: string, connect: string): void {
  const { PermissionsAndroid } = rn;
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]: scan,
    [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]: connect,
  } as never);
}

describe('requestBlePermissions', () => {
  it('asks for the location grant below Android 12 and reports a refusal', async () => {
    setPlatform('android', 30);
    mockRequestLocation.mockResolvedValue({ status: 'denied', canAskAgain: true });

    await expect(manager.requestBlePermissions()).resolves.toBe('denied');
    expect(mockRequestLocation).toHaveBeenCalled();
    expect(store.getState().availability).toBe('unauthorised');
  });

  it('reports a location grant that will not be asked again as blocked', async () => {
    setPlatform('android', 29);
    mockRequestLocation.mockResolvedValue({ status: 'denied', canAskAgain: false });

    await expect(manager.requestBlePermissions()).resolves.toBe('blocked');
    expect(store.getState().availability).toBe('blocked');
  });

  it('reports location services off below Android 12, where a scan finds nothing without them', async () => {
    setPlatform('android', 30);
    mockRequestLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocationServicesOn.mockResolvedValue(false);

    await expect(manager.requestBlePermissions()).resolves.toBe('needsLocation');
    expect(store.getState().availability).toBe('needsLocation');
  });

  it('grants below Android 12 with the location grant and services on', async () => {
    setPlatform('android', 30);
    mockRequestLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocationServicesOn.mockResolvedValue(true);

    await expect(manager.requestBlePermissions()).resolves.toBe('granted');
  });

  it('does not ask for location from Android 12', async () => {
    setPlatform('android', 33);
    androidAnswers(GRANTED, GRANTED);

    await expect(manager.requestBlePermissions()).resolves.toBe('granted');
    expect(mockRequestLocation).not.toHaveBeenCalled();
  });

  it('reports one refused Bluetooth permission as denied', async () => {
    setPlatform('android', 33);
    androidAnswers(GRANTED, DENIED);

    await expect(manager.requestBlePermissions()).resolves.toBe('denied');
    expect(store.getState().availability).toBe('unauthorised');
  });

  it("reports don't ask again as blocked", async () => {
    setPlatform('android', 33);
    androidAnswers(NEVER, DENIED);

    await expect(manager.requestBlePermissions()).resolves.toBe('blocked');
    expect(store.getState().availability).toBe('blocked');
  });

  it('reports a request that throws as denied', async () => {
    setPlatform('android', 33);
    jest
      .spyOn(rn.PermissionsAndroid, 'requestMultiple')
      .mockRejectedValue(new Error('no activity'));

    await expect(manager.requestBlePermissions()).resolves.toBe('denied');
  });

  it('clears a refusal once a later request is granted', async () => {
    setPlatform('android', 33);
    androidAnswers(DENIED, DENIED);
    await manager.requestBlePermissions();
    androidAnswers(GRANTED, GRANTED);
    await manager.requestBlePermissions();

    expect(store.getState().availability).not.toBe('unauthorised');
  });

  it('does not scan after a refusal', async () => {
    setPlatform('android', 33);
    androidAnswers(DENIED, DENIED);

    await manager.startScan();

    expect(mockConstructed).not.toHaveBeenCalled();
    expect(mockStartDeviceScan).not.toHaveBeenCalled();
    expect(store.getState().scanning).toBe(false);
  });
});

describe('refreshBleAccess, on the way back from the system settings', () => {
  function androidHolds(held: boolean): void {
    jest.spyOn(rn.PermissionsAndroid, 'check').mockResolvedValue(held);
  }

  it('reads a grant made in the settings without asking', async () => {
    setPlatform('android', 33);
    androidAnswers(NEVER, NEVER);
    await manager.requestBlePermissions();
    expect(store.getState().availability).toBe('blocked');

    androidHolds(true);
    await manager.refreshBleAccess();

    expect(store.getState().availability).not.toBe('blocked');
    expect(rn.PermissionsAndroid.requestMultiple).toHaveBeenCalledTimes(1);
  });

  it('keeps a refusal blocked while it is still refused', async () => {
    setPlatform('android', 33);
    androidAnswers(NEVER, NEVER);
    await manager.requestBlePermissions();

    androidHolds(false);
    await manager.refreshBleAccess();

    expect(store.getState().availability).toBe('blocked');
  });

  it('reads location services turned on below Android 12', async () => {
    setPlatform('android', 30);
    mockRequestLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocationServicesOn.mockResolvedValue(false);
    await manager.requestBlePermissions();
    expect(store.getState().availability).toBe('needsLocation');

    mockReadLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
    mockLocationServicesOn.mockResolvedValue(true);
    await manager.refreshBleAccess();

    expect(store.getState().availability).not.toBe('needsLocation');
  });

  it('reads nothing before the first ask', async () => {
    setPlatform('android', 33);
    androidHolds(true);
    await manager.refreshBleAccess();

    expect(rn.PermissionsAndroid.check).not.toHaveBeenCalled();
    expect(store.getState().availability).toBe('unknown');
  });
});

describe('a ride with paired sensors and the radio off', () => {
  beforeEach(() => {
    store.setState({ knownSensors: [SENSOR], connections: {} });
  });

  it('says Bluetooth is off rather than reconnecting', async () => {
    mockConnectToDevice.mockRejectedValue(bleError(BleErrorCode.BluetoothPoweredOff));

    await manager.connectKnownSensors();
    await settle();

    const { result, unmount } = await renderHook(() => useSensorIssue());
    expect(result.current).toBe('sensors.title: sensors.issue.bluetoothOff');
    await unmount();
  });

  it('does not retry while the radio is off, and reconnects when it comes on', async () => {
    jest.useFakeTimers();
    mockConnectToDevice.mockRejectedValue(bleError(BleErrorCode.BluetoothPoweredOff));

    await manager.connectKnownSensors();
    await settle();
    jest.advanceTimersByTime(5 * 60_000);
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);

    emitAdapter('PoweredOn');
    await settle();
    expect(mockConnectToDevice).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect a sensor forgotten while the radio was off', async () => {
    mockConnectToDevice.mockRejectedValue(bleError(BleErrorCode.BluetoothPoweredOff));

    await manager.connectKnownSensors();
    await settle();
    await manager.disconnectSensor(SENSOR.id);
    emitAdapter('PoweredOn');
    await settle();

    expect(mockConnectToDevice).toHaveBeenCalledTimes(1);
  });

  it('says a permission is needed when the ride starts refused', async () => {
    setPlatform('android', 33);
    androidAnswers(DENIED, DENIED);
    await manager.requestBlePermissions();

    const { result, unmount } = await renderHook(() => useSensorIssue());
    expect(result.current).toBe('sensors.title: sensors.issue.permission');
    await unmount();
  });

  it('says nothing about the radio when no sensor is paired', async () => {
    store.setState({ knownSensors: [] });
    const scan = manager.startScan();
    await settle();
    emitAdapter('PoweredOff');
    await scan;

    const { result, unmount } = await renderHook(() => useSensorIssue());
    expect(result.current).toBeNull();
    await unmount();
  });
});
