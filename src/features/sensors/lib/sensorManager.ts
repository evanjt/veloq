import { Linking, NativeModules, Platform, PermissionsAndroid } from 'react-native';
import * as Location from 'expo-location';
import { BleErrorCode, State } from 'react-native-ble-plx';

import { debug } from '@/shared/debug/debug';
import { useSensorStore } from '../store';
import {
  HEART_RATE_SERVICE,
  HEART_RATE_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_MEASUREMENT,
  CSC_SERVICE,
  CSC_MEASUREMENT,
  BATTERY_SERVICE,
  BATTERY_LEVEL,
  parseHeartRate,
  parseCyclingPower,
  parseCsc,
  parseBatteryLevel,
  base64ToBytes,
} from './gatt';
import { createCrankCadenceCalculator } from './cadence';
import { SENSOR_NO_DATA_MS, sensorConnectionHealth } from './connectionHealth';
import type { KnownSensor, SensorAvailability, SensorKind } from '../types';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

const log = debug.create('Sensors');

const SCANNED_SERVICES = [HEART_RATE_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE];
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;
/** How often a live connection is re-checked against the no-data watchdog. */
const HEALTH_TICK_MS = 2000;
/**
 * How long one scan runs before it stops by itself. A strap or meter that is
 * awake advertises several times a second, so a sensor not heard in this
 * window is not nearby, and an open-ended scan costs battery for nothing.
 */
export const SCAN_WINDOW_MS = 30_000;

let bleManager: BleManager | null = null;
let bleUnavailable = false;

/** The adapter as the manager last heard it, null until the manager exists. */
let adapterState: State | null = null;
/** The last Android permission outcome, null until one is asked for. iOS answers through the adapter. */
let access: BleAccess | null = null;
let adapterWaiters: ((state: State) => void)[] = [];

/**
 * Lazily create the BleManager; null when the native module is absent (Expo
 * Go, tests). Constructing it is what raises the iOS Bluetooth prompt, so it
 * happens only once the athlete scans or starts a ride with paired sensors.
 */
function getBle(): BleManager | null {
  if (bleManager) return bleManager;
  if (!isBleAvailable()) return null;
  try {
    const { BleManager: Manager } = require('react-native-ble-plx');
    const ble: BleManager = new Manager();
    bleManager = ble;
    ble.onStateChange(onAdapterState, true);
    return ble;
  } catch (e) {
    log.warn('BLE unavailable:', e);
    bleUnavailable = true;
    publishAvailability();
    return null;
  }
}

/** Whether this build carries the Bluetooth module. Never constructs the manager. */
export function isBleAvailable(): boolean {
  return !bleUnavailable && NativeModules.BlePlx != null;
}

/**
 * `granted`, refused but askable, refused for good, or (Android 7 to 11)
 * granted with location services off, where a scan finds nothing.
 */
export type BleAccess = 'granted' | 'denied' | 'blocked' | 'needsLocation';

interface AvailabilityInput {
  moduleAvailable: boolean;
  access: BleAccess | null;
  adapter: State | null;
  os: string;
}

/**
 * The one answer to whether sensors can be reached. A refusal outranks the
 * radio, because nothing about the radio can be read or fixed without the
 * grant, and the radio outranks location services, which only matter to a
 * scan once it is on. iOS never asks twice, so its refusal is blocked.
 */
export function sensorAvailability({
  moduleAvailable,
  access: granted,
  adapter,
  os,
}: AvailabilityInput): SensorAvailability {
  if (!moduleAvailable || adapter === State.Unsupported) return 'unsupported';
  if (granted === 'denied') return 'unauthorised';
  if (granted === 'blocked') return 'blocked';
  if (adapter === State.Unauthorized) return os === 'ios' ? 'blocked' : 'unauthorised';
  if (adapter === State.PoweredOff) return 'poweredOff';
  if (granted === 'needsLocation') return 'needsLocation';
  if (adapter === State.PoweredOn) return 'ready';
  return 'unknown';
}

function publishAvailability(): void {
  const availability = sensorAvailability({
    moduleAvailable: isBleAvailable(),
    access,
    adapter: adapterState,
    os: Platform.OS,
  });
  if (useSensorStore.getState().availability === availability) return;
  useSensorStore.getState().setAvailability(availability);
}

function isSettled(state: State): boolean {
  return state !== State.Unknown && state !== State.Resetting;
}

function onAdapterState(state: State): void {
  const wasOn = adapterState === State.PoweredOn;
  adapterState = state;
  publishAvailability();
  if (isSettled(state)) {
    const waiters = adapterWaiters;
    adapterWaiters = [];
    for (const resolve of waiters) resolve(state);
  }
  if (state === State.PoweredOn && !wasOn) resumeParkedSensors();
}

/** The adapter once it has said on, off or refused; on iOS that waits for the prompt. */
function adapterSettled(): Promise<State> {
  if (adapterState && isSettled(adapterState)) return Promise.resolve(adapterState);
  return new Promise((resolve) => adapterWaiters.push(resolve));
}

/**
 * ble-plx reports the radio being off, refused or missing as an error on the
 * scan or the connect, which can arrive before the state listener hears it.
 * Returns whether the error was one of those.
 */
function noteBleError(error: unknown): boolean {
  const code = (error as { errorCode?: number } | null)?.errorCode;
  const state =
    code === BleErrorCode.BluetoothPoweredOff
      ? State.PoweredOff
      : code === BleErrorCode.BluetoothUnauthorized
        ? State.Unauthorized
        : code === BleErrorCode.BluetoothUnsupported
          ? State.Unsupported
          : null;
  if (!state) return false;
  onAdapterState(state);
  return true;
}

/** A connect cannot succeed until the athlete changes something. */
function radioBlocksConnect(): boolean {
  const availability = useSensorStore.getState().availability;
  return (
    availability === 'poweredOff' ||
    availability === 'unauthorised' ||
    availability === 'blocked' ||
    availability === 'unsupported'
  );
}

/** Pick between granted and refused on Android, where one refusal of either permission is a refusal. */
export function androidPermissionOutcome(results: string[]): 'granted' | 'denied' | 'blocked' {
  if (results.every((r) => r === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  if (results.some((r) => r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return 'blocked';
  return 'denied';
}

async function askBleAccess(): Promise<BleAccess> {
  // iOS asks when the manager is constructed and reports through the adapter.
  if (Platform.OS !== 'android') return 'granted';
  try {
    if (Platform.Version < 31) {
      // Android 7 to 11 return scan results only to an app holding the
      // location grant, and only while location services are on.
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return canAskAgain ? 'denied' : 'blocked';
      return (await Location.hasServicesEnabledAsync()) ? 'granted' : 'needsLocation';
    }
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return androidPermissionOutcome(Object.values(results));
  } catch {
    return 'denied';
  }
}

function recordAccess(outcome: BleAccess): void {
  access = outcome;
  // A refusal a scan error reported is superseded by a grant, so the adapter
  // is read again rather than trusted.
  if (outcome !== 'denied' && outcome !== 'blocked' && adapterState === State.Unauthorized) {
    adapterState = null;
    bleManager
      ?.state()
      .then(onAdapterState)
      .catch(() => {
        // The state listener answers on its own.
      });
  }
  publishAvailability();
}

/**
 * Ask for what a scan or a connect needs and record the answer as the
 * sensors' availability. Android 12+ needs BLUETOOTH_SCAN and
 * BLUETOOTH_CONNECT, Android 7 to 11 the location grant.
 */
export async function requestBlePermissions(): Promise<BleAccess> {
  const outcome = await askBleAccess();
  if (Platform.OS === 'android') recordAccess(outcome);
  return outcome;
}

/**
 * Read the grant again without asking, for the athlete coming back from the
 * system settings. Android does not restart the app for a grant, and turning
 * location services on restarts nothing. Only a grant can be read without
 * asking, so a refusal keeps the last answer, askable or blocked.
 */
export async function refreshBleAccess(): Promise<void> {
  if (Platform.OS !== 'android' || access === null) return;
  try {
    const held =
      Platform.Version < 31
        ? (await Location.getForegroundPermissionsAsync()).status === 'granted'
        : (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN)) &&
          (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT));
    if (!held) {
      if (access === 'granted' || access === 'needsLocation') recordAccess('denied');
      return;
    }
    const servicesOn = Platform.Version >= 31 || (await Location.hasServicesEnabledAsync());
    recordAccess(servicesOn ? 'granted' : 'needsLocation');
  } catch {
    // The last answer stands.
  }
}

/**
 * Turn the radio on where the system lets an app ask: directly below Android
 * 12, through the system request from 12, and Bluetooth settings when that
 * cannot be shown. iOS offers an app nothing, so its screen says where.
 */
export async function turnOnBluetooth(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const openBluetoothSettings = () =>
    Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings());
  if (Platform.Version < 31) {
    const ble = getBle();
    if (!ble) return;
    ble.enable().catch(openBluetoothSettings);
    return;
  }
  await Linking.sendIntent('android.bluetooth.adapter.action.REQUEST_ENABLE').catch(
    openBluetoothSettings
  );
}

function kindsFromServiceUUIDs(serviceUUIDs: string[] | null): SensorKind[] {
  const kinds: SensorKind[] = [];
  const lower = (serviceUUIDs ?? []).map((u) => u.toLowerCase());
  if (lower.includes(HEART_RATE_SERVICE)) kinds.push('heartRate');
  if (lower.includes(CYCLING_POWER_SERVICE)) kinds.push('power');
  if (lower.includes(CSC_SERVICE)) kinds.push('cadence');
  return kinds;
}

// ─── Scanning ─────────────────────────────────────────────────────────────────

/** Bumped by every scan start and stop, so a scan still waiting on the prompt can see it was stopped. */
let scanGeneration = 0;
let scanWindowTimer: ReturnType<typeof setTimeout> | null = null;

function clearScanWindow(): void {
  if (scanWindowTimer) clearTimeout(scanWindowTimer);
  scanWindowTimer = null;
}

/**
 * Ask for the permission, construct the manager, wait for the adapter, then
 * scan for `SCAN_WINDOW_MS`. Each step that fails leaves the reason in the
 * store's availability and the scan stopped.
 */
export async function startScan(): Promise<void> {
  const generation = ++scanGeneration;
  clearScanWindow();
  const store = useSensorStore.getState();
  store.clearDiscovered();
  store.setScanFinished(false);

  const granted = await requestBlePermissions();
  if (generation !== scanGeneration || granted !== 'granted') return;
  const ble = getBle();
  if (!ble) return;
  useSensorStore.getState().setScanning(true);

  const state = await adapterSettled();
  if (generation !== scanGeneration) return;
  if (state !== State.PoweredOn) {
    useSensorStore.getState().setScanning(false);
    return;
  }

  ble.startDeviceScan(SCANNED_SERVICES, { allowDuplicates: false }, (error, device) => {
    if (generation !== scanGeneration) return;
    if (error) {
      log.warn('Scan error:', error.message);
      noteBleError(error);
      stopScan();
      return;
    }
    if (!device) return;
    const kinds = kindsFromServiceUUIDs(device.serviceUUIDs);
    if (kinds.length === 0) return;
    useSensorStore.getState().upsertDiscovered({
      id: device.id,
      name: device.name ?? device.localName ?? device.id,
      kinds,
      rssi: device.rssi,
    });
  });

  scanWindowTimer = setTimeout(() => {
    scanWindowTimer = null;
    if (generation !== scanGeneration) return;
    stopScan();
    useSensorStore.getState().setScanFinished(true);
  }, SCAN_WINDOW_MS);
}

/** Never constructs the manager: one that does not exist is not scanning. */
export function stopScan(): void {
  scanGeneration++;
  clearScanWindow();
  bleManager?.stopDeviceScan();
  useSensorStore.getState().setScanning(false);
}

// ─── Connections ──────────────────────────────────────────────────────────────

interface ActiveConnection {
  device: Device;
  subscriptions: Subscription[];
  disconnectSub: Subscription | null;
  cancelled: boolean;
  reconnectAttempt: number;
  /** `first` for the initial connect, `retry` once a reconnect drove it. */
  attempt: 'first' | 'retry';
  /** When the monitors were registered, null while they are being registered. */
  subscribedAt: number | null;
  /** When this sensor last delivered a notification, null if it never has. */
  lastSampleAt: number | null;
  healthTimer: ReturnType<typeof setInterval> | null;
}

const activeConnections = new Map<string, ActiveConnection>();

/**
 * The pending reconnect per sensor, so a deliberate disconnect can cancel it.
 * It used to be a field on `ActiveConnection`, which is deleted before the
 * reconnect is ever scheduled, so nothing held the handle and the `clearTimeout`
 * that read it could never fire.
 */
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Bumped by every teardown, so a connect still in flight can see that the
 * sensor it is connecting was disconnected while it awaited. Without it the
 * landing connect recreated the entry after the ride ended, and the next
 * ride's `connectKnownSensors` returned early against it.
 */
const connectGenerations = new Map<string, number>();

/**
 * Write the sensor's derived status into the store. Called when a sample
 * lands and on every watchdog tick, so the row follows the link rather than
 * the GATT handshake.
 */
function publishHealth(sensor: KnownSensor, active: ActiveConnection): void {
  const status = sensorConnectionHealth({
    attempt: active.attempt,
    subscribedAt: active.subscribedAt,
    lastSampleAt: active.lastSampleAt,
    now: Date.now(),
  });
  const existing = useSensorStore.getState().connections[sensor.id];
  if (existing?.status === status) return;
  useSensorStore.getState().setConnection(sensor.id, {
    ...existing,
    status,
    name: sensor.name,
    kinds: sensor.kinds,
  });
}

/**
 * A notification arrived, whatever it carried. The link is what is being
 * timed here, so an unparseable frame counts: it still proves data flows.
 */
function noteSample(sensor: KnownSensor, active: ActiveConnection): void {
  active.lastSampleAt = Date.now();
  publishHealth(sensor, active);
}

/**
 * ble-plx returns a failed CCCD write, a GATT error and a dropped notification
 * stream through the monitor callback. Dropping it left a silent strap
 * indistinguishable from a working one.
 */
function logMonitorError(sensor: KnownSensor, characteristic: string, error: unknown): void {
  const message = (error as { message?: string })?.message ?? String(error);
  log.warn(`Sensor monitor failed: ${sensor.name}`, `${characteristic}: ${message}`);
}

async function subscribeToSensor(active: ActiveConnection, sensor: KnownSensor): Promise<void> {
  const { device } = active;
  const { kinds } = sensor;
  const store = useSensorStore.getState;

  if (kinds.includes('heartRate')) {
    active.subscriptions.push(
      device.monitorCharacteristicForService(
        HEART_RATE_SERVICE,
        HEART_RATE_MEASUREMENT,
        (error, characteristic) => {
          if (error) {
            logMonitorError(sensor, 'heart rate', error);
            return;
          }
          if (!characteristic?.value) return;
          noteSample(sensor, active);
          const hr = parseHeartRate(base64ToBytes(characteristic.value));
          if (hr != null && hr > 0 && hr < 255) store().setLatest('heartRate', hr);
        }
      )
    );
  }

  if (kinds.includes('power')) {
    const cadenceFromCrank = createCrankCadenceCalculator();
    active.subscriptions.push(
      device.monitorCharacteristicForService(
        CYCLING_POWER_SERVICE,
        CYCLING_POWER_MEASUREMENT,
        (error, characteristic) => {
          if (error) {
            logMonitorError(sensor, 'cycling power', error);
            return;
          }
          if (!characteristic?.value) return;
          noteSample(sensor, active);
          const parsed = parseCyclingPower(base64ToBytes(characteristic.value));
          if (!parsed) return;
          if (parsed.power >= 0) store().setLatest('power', parsed.power);
          if (parsed.crank) {
            const rpm = cadenceFromCrank.update(parsed.crank, Date.now());
            if (rpm != null) store().setLatest('cadence', rpm);
          }
        }
      )
    );
  }

  if (kinds.includes('cadence')) {
    const cadenceFromCrank = createCrankCadenceCalculator();
    active.subscriptions.push(
      device.monitorCharacteristicForService(CSC_SERVICE, CSC_MEASUREMENT, (error, char) => {
        if (error) {
          logMonitorError(sensor, 'speed and cadence', error);
          return;
        }
        if (!char?.value) return;
        noteSample(sensor, active);
        const parsed = parseCsc(base64ToBytes(char.value));
        if (parsed?.crank) {
          const rpm = cadenceFromCrank.update(parsed.crank, Date.now());
          if (rpm != null) store().setLatest('cadence', rpm);
        }
      })
    );
  }

  // Battery is optional - read once, ignore absence
  try {
    const battery = await device.readCharacteristicForService(BATTERY_SERVICE, BATTERY_LEVEL);
    if (battery.value) {
      const percent = parseBatteryLevel(base64ToBytes(battery.value));
      if (percent != null) store().setBattery(device.id, percent);
    }
  } catch {
    // No battery service - fine
  }
}

async function connectAndSubscribe(sensor: KnownSensor, attempt: number): Promise<void> {
  const ble = getBle();
  if (!ble) return;

  const existing = activeConnections.get(sensor.id);
  if (existing && !existing.cancelled) return;

  useSensorStore.getState().setConnection(sensor.id, {
    status: attempt === 0 ? 'connecting' : 'reconnecting',
    name: sensor.name,
    kinds: sensor.kinds,
  });
  if (radioBlocksConnect()) {
    parkSensor(sensor);
    return;
  }

  const generation = connectGenerations.get(sensor.id) ?? 0;
  const superseded = () => (connectGenerations.get(sensor.id) ?? 0) !== generation;

  try {
    const device = await ble.connectToDevice(sensor.id, { timeout: 10_000 });
    if (superseded()) {
      abandonConnect(sensor.id);
      return;
    }
    await device.discoverAllServicesAndCharacteristics();
    if (superseded()) {
      abandonConnect(sensor.id);
      return;
    }

    const active: ActiveConnection = {
      device,
      subscriptions: [],
      disconnectSub: null,
      cancelled: false,
      reconnectAttempt: 0,
      attempt: attempt === 0 ? 'first' : 'retry',
      subscribedAt: null,
      lastSampleAt: null,
      healthTimer: null,
    };
    activeConnections.set(sensor.id, active);

    active.disconnectSub = ble.onDeviceDisconnected(sensor.id, () => {
      log.warn(`Sensor disconnected: ${sensor.name}`);
      cleanupConnection(sensor.id, { keepStoreEntry: true });
      const conn = useSensorStore.getState().connections[sensor.id];
      if (conn) scheduleReconnect(sensor);
    });

    await subscribeToSensor(active, sensor);
    if (superseded()) {
      cleanupConnection(sensor.id);
      abandonConnect(sensor.id);
      return;
    }
    active.subscribedAt = Date.now();
    publishHealth(sensor, active);
    active.healthTimer = setInterval(() => watchdogTick(sensor), HEALTH_TICK_MS);
    log.log(`Sensor link open: ${sensor.name} (${sensor.kinds.join(', ')}), waiting for data`);
  } catch (e) {
    log.warn(`Failed to connect ${sensor.name}:`, e);
    noteBleError(e);
    scheduleReconnect(sensor, attempt + 1);
  }
}

/**
 * A link that has carried nothing for the watchdog interval is reported as
 * such and then torn down for a reconnect, because a fresh connect and CCCD
 * write is the recovery every BLE central falls back to.
 */
function watchdogTick(sensor: KnownSensor): void {
  const active = activeConnections.get(sensor.id);
  if (!active || active.cancelled) return;
  publishHealth(sensor, active);
  if (useSensorStore.getState().connections[sensor.id]?.status !== 'noData') return;

  log.warn(`Sensor sent nothing for ${SENSOR_NO_DATA_MS} ms, reconnecting: ${sensor.name}`);
  cleanupConnection(sensor.id, { keepStoreEntry: true });
  void bleManager?.cancelDeviceConnection(sensor.id).catch(() => {
    // Already gone, which is the outcome wanted.
  });
  scheduleReconnect(sensor);
}

/** Drop the device a superseded connect opened, so it does not stay connected. */
function abandonConnect(id: string): void {
  log.log(`Dropping a sensor connect that was disconnected while it was in flight: ${id}`);
  void bleManager?.cancelDeviceConnection(id).catch(() => {
    // Already gone, which is the outcome wanted.
  });
}

function scheduleReconnect(sensor: KnownSensor, attempt = 1): void {
  const conn = useSensorStore.getState().connections[sensor.id];
  if (!conn) return; // Disconnected deliberately
  // A silent link keeps saying so while the reconnect runs: "no data" is what
  // the athlete can act on, "reconnecting" is only how it is being fixed.
  if (conn.status !== 'noData') {
    useSensorStore.getState().setConnectionStatus(sensor.id, 'reconnecting');
  }
  if (radioBlocksConnect()) {
    parkSensor(sensor);
    return;
  }
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), RECONNECT_MAX_MS);
  const timer = setTimeout(() => {
    reconnectTimers.delete(sensor.id);
    // Still wanted? (disconnectSensor removes the store entry)
    if (!useSensorStore.getState().connections[sensor.id]) return;
    connectAndSubscribe(sensor, attempt);
  }, delay);
  const previous = reconnectTimers.get(sensor.id);
  if (previous) clearTimeout(previous);
  reconnectTimers.set(sensor.id, timer);
}

/**
 * Sensors a ride wants while the radio is off or refused. Retrying against
 * an adapter that is off fails every time, so they wait here for it to come
 * on rather than backing off for the whole ride.
 */
const parkedSensors = new Map<string, KnownSensor>();

function parkSensor(sensor: KnownSensor): void {
  log.log(`Waiting for Bluetooth before connecting: ${sensor.name}`);
  const timer = reconnectTimers.get(sensor.id);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(sensor.id);
  parkedSensors.set(sensor.id, sensor);
}

function resumeParkedSensors(): void {
  const parked = [...parkedSensors.values()];
  parkedSensors.clear();
  for (const sensor of parked) {
    // Still wanted? (disconnectSensor removes the store entry)
    if (!useSensorStore.getState().connections[sensor.id]) continue;
    void connectAndSubscribe(sensor, 1);
  }
}

function cleanupConnection(id: string, options?: { keepStoreEntry?: boolean }): void {
  // Before anything else: a connect still in flight has to see this.
  connectGenerations.set(id, (connectGenerations.get(id) ?? 0) + 1);
  parkedSensors.delete(id);
  const timer = reconnectTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(id);
  }
  const active = activeConnections.get(id);
  if (active) {
    active.cancelled = true;
    if (active.healthTimer) clearInterval(active.healthTimer);
    for (const sub of active.subscriptions) sub.remove();
    active.disconnectSub?.remove();
    activeConnections.delete(id);
  }
  if (!options?.keepStoreEntry) {
    useSensorStore.getState().setConnection(id, null);
  }
}

/** Connect every paired sensor (called when a recording session starts). */
export async function connectKnownSensors(): Promise<void> {
  const { knownSensors } = useSensorStore.getState();
  for (const sensor of knownSensors) {
    connectAndSubscribe(sensor, 0);
  }
}

export async function disconnectSensor(id: string): Promise<void> {
  cleanupConnection(id);
  try {
    await bleManager?.cancelDeviceConnection(id);
  } catch {
    // Already disconnected
  }
}

export async function disconnectAllSensors(): Promise<void> {
  const ids = [...activeConnections.keys()];
  const storeIds = Object.keys(useSensorStore.getState().connections);
  for (const id of new Set([...ids, ...storeIds])) {
    await disconnectSensor(id);
  }
}
