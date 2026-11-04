import { Linking, NativeModules, Platform, PermissionsAndroid } from 'react-native';
import * as Location from 'expo-location';
import { BleErrorCode, State } from 'react-native-ble-plx';

import { debug } from '@/shared/debug/debug';
import { useRecordingStore } from '@/features/recording';
import { useSensorStore } from '../store';
import {
  HEART_RATE_SERVICE,
  HEART_RATE_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_MEASUREMENT,
  CSC_SERVICE,
  CSC_MEASUREMENT,
  RSC_SERVICE,
  RSC_MEASUREMENT,
  BATTERY_SERVICE,
  BATTERY_LEVEL,
  parseHeartRate,
  parseCyclingPower,
  parseCsc,
  parseBatteryLevel,
  base64ToBytes,
} from './gatt';
import { applyRscFrame } from './runningPod';
import { createCrankCadenceCalculator } from './cadence';
import { sensorConnectionHealth } from './connectionHealth';
import { recordSensorLink, type SensorLinkEvent } from './sensorLinkTrace';
import { stopSimulatedSensors } from './simulatedSensors';
import type { KnownSensor, SensorAvailability, SensorKind } from '../types';
import type { BleManager, ConnectionOptions, Device, Subscription } from 'react-native-ble-plx';

const log = debug.create('Sensors');

const SCANNED_SERVICES = [HEART_RATE_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE, RSC_SERVICE];
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

export function kindsFromServiceUUIDs(serviceUUIDs: string[] | null): SensorKind[] {
  const kinds: SensorKind[] = [];
  const lower = (serviceUUIDs ?? []).map((u) => u.toLowerCase());
  if (lower.includes(HEART_RATE_SERVICE)) kinds.push('heartRate');
  if (lower.includes(CYCLING_POWER_SERVICE)) kinds.push('power');
  if (lower.includes(CSC_SERVICE)) kinds.push('cadence');
  if (lower.includes(RSC_SERVICE)) kinds.push('runningCadence');
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

  // One scan runs at a time, so this one replaces a search for a sensor and
  // `noteSeen` below keeps serving it.
  seekScanActive = false;
  ble.startDeviceScan(SCANNED_SERVICES, { allowDuplicates: false }, (error, device) => {
    if (generation !== scanGeneration) return;
    if (error) {
      log.warn('Scan error:', error.message);
      noteBleError(error);
      stopScan();
      return;
    }
    if (!device) return;
    noteSeen(device.id);
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
  startSeekScan();
}

// ─── Connections ──────────────────────────────────────────────────────────────

/** One characteristic monitor, counted so the trace can say what it carried. */
interface MonitorLink {
  characteristic: string;
  registeredAt: number;
  samples: number;
}

interface ActiveConnection {
  sensor: KnownSensor;
  device: Device;
  monitors: MonitorLink[];
  subscriptions: Subscription[];
  disconnectSub: Subscription | null;
  cancelled: boolean;
  /** `first` for the initial connect, `retry` once a reconnect drove it. */
  attempt: 'first' | 'retry';
  /** When the monitors were registered, null while they are being registered. */
  subscribedAt: number | null;
  /** When this sensor last delivered a notification, null if it never has. */
  lastSampleAt: number | null;
  healthTimer: ReturnType<typeof setInterval> | null;
}

const activeConnections = new Map<string, ActiveConnection>();

/** Write one event about this sensor's link into the trace the debug screen reads. */
function traceLink(
  sensor: KnownSensor,
  kind: SensorLinkEvent['kind'],
  fields?: Pick<SensorLinkEvent, 'characteristic' | 'ms' | 'count' | 'detail'>
): void {
  recordSensorLink({ sensorId: sensor.id, sensorName: sensor.name, kind, ...fields });
}

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

/** A screen that keeps the paired sensors connected while it is open. */
export type SensorHolder = 'entry' | 'session';

/**
 * The screens holding the paired sensors: the record entry screen from the
 * moment it opens, and the recording screen. Emptied by
 * `disconnectAllSensors`, which ends the session.
 */
const holders = new Set<SensorHolder>();

/**
 * How long the last hold may be let go before the sensors are disconnected.
 * Start replaces the entry screen with the recording screen, and which of the
 * two runs its effect first is up to the navigator, so the recording screen's
 * hold has this long to land before anything is torn down.
 */
export const SENSOR_RELEASE_GRACE_MS = 2000;

let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/** Sensors the athlete disconnected for this session, which no hold connects again. */
const droppedForSession = new Set<string>();

/** Sensors the Sensors screen connected to confirm a pairing. */
const pairingConnections = new Set<string>();

/**
 * Whether a recording session owns the connections: the recording screen has
 * taken them, or a ride is under way. Only then is a dropped link reconnected
 * and a pairing connection kept when its screen is left.
 */
function sessionOwnsConnections(): boolean {
  return holders.size > 0 || useRecordingStore.getState().status !== 'idle';
}

/**
 * Write the sensor's derived status into the store. Called when a sample
 * lands and on every watchdog tick, so the row follows the link rather than
 * the GATT handshake.
 */
function publishHealth(sensor: KnownSensor, active: ActiveConnection): void {
  const now = Date.now();
  const status = sensorConnectionHealth({
    attempt: active.attempt,
    subscribedAt: active.subscribedAt,
    lastSampleAt: active.lastSampleAt,
    now,
  });
  const existing = useSensorStore.getState().connections[sensor.id];
  if (existing?.status === status) return;
  if (status === 'noData') {
    const since = active.lastSampleAt ?? active.subscribedAt ?? now;
    log.warn(`Sensor sent nothing for ${now - since} ms: ${sensor.name}`);
    traceLink(sensor, 'watchdogFired', { ms: now - since });
  }
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
function noteSample(sensor: KnownSensor, active: ActiveConnection, link: MonitorLink): void {
  const now = Date.now();
  active.lastSampleAt = now;
  link.samples++;
  if (link.samples === 1) {
    traceLink(sensor, 'firstSample', {
      characteristic: link.characteristic,
      ms: now - link.registeredAt,
    });
  }
  publishHealth(sensor, active);
}

/**
 * ble-plx returns a failed CCCD write, a GATT error and a dropped notification
 * stream through the monitor callback. Dropping it left a silent strap
 * indistinguishable from a working one.
 */
function logMonitorError(
  sensor: KnownSensor,
  label: string,
  characteristic: string,
  error: unknown
): void {
  const message = (error as { message?: string })?.message ?? String(error);
  log.warn(`Sensor monitor failed: ${sensor.name}`, `${label}: ${message}`);
  traceLink(sensor, 'monitorError', { characteristic, detail: message });
}

/**
 * A monitor error ends the link and connects again with a fresh service table,
 * which is what a re-subscribe can fix. A link that delivered a sample
 * reconnects at once through the pending connect. One that never did is paced
 * by the timed backoff, so a sensor whose notification enable fails on every
 * connect is not reconnected in a tight loop. Only the first error of a link
 * acts: the teardown removes its subscriptions.
 */
function recoverFromMonitorError(active: ActiveConnection, sensor: KnownSensor): void {
  if (active.cancelled) return;
  const delivered = active.lastSampleAt != null;
  cleanupConnection(sensor.id, { keepStoreEntry: true });
  void (async () => {
    try {
      await bleManager?.cancelDeviceConnection(sensor.id);
    } catch {
      // Already gone, which is the outcome wanted.
    }
    if (!useSensorStore.getState().connections[sensor.id]) return;
    if (delivered) pendReconnect(sensor, { freshTable: true });
    else scheduleReconnect(sensor, 1, { freshTable: true });
  })();
}

/**
 * Register one characteristic monitor. An error is logged and traced, an empty
 * frame is ignored, and every frame with a value is counted as a sample before
 * `onValue` parses it.
 */
function monitorCharacteristic(
  active: ActiveConnection,
  sensor: KnownSensor,
  service: string,
  characteristic: string,
  label: string,
  onValue: (value: string) => void
): void {
  const link: MonitorLink = { characteristic, registeredAt: Date.now(), samples: 0 };
  active.monitors.push(link);
  traceLink(sensor, 'monitorRegistered', { characteristic });
  active.subscriptions.push(
    active.device.monitorCharacteristicForService(service, characteristic, (error, frame) => {
      if (error) {
        logMonitorError(sensor, label, characteristic, error);
        recoverFromMonitorError(active, sensor);
        return;
      }
      if (!frame?.value) return;
      noteSample(sensor, active, link);
      onValue(frame.value);
    })
  );
}

async function subscribeToSensor(active: ActiveConnection, sensor: KnownSensor): Promise<void> {
  const { device } = active;
  const { kinds } = sensor;
  const store = useSensorStore.getState;

  if (kinds.includes('heartRate')) {
    monitorCharacteristic(
      active,
      sensor,
      HEART_RATE_SERVICE,
      HEART_RATE_MEASUREMENT,
      'heart rate',
      (value) => {
        const hr = parseHeartRate(base64ToBytes(value));
        if (hr != null && hr > 0 && hr < 255) store().setLatest('heartRate', hr, sensor.id);
      }
    );
  }

  if (kinds.includes('power')) {
    const cadenceFromCrank = createCrankCadenceCalculator();
    monitorCharacteristic(
      active,
      sensor,
      CYCLING_POWER_SERVICE,
      CYCLING_POWER_MEASUREMENT,
      'cycling power',
      (value) => {
        const parsed = parseCyclingPower(base64ToBytes(value));
        if (!parsed) return;
        if (parsed.power >= 0) store().setLatest('power', parsed.power, sensor.id);
        if (parsed.crank) {
          const rpm = cadenceFromCrank.update(parsed.crank, Date.now());
          if (rpm != null) store().setLatest('cadence', rpm, sensor.id, 'derived');
        }
      }
    );
  }

  if (kinds.includes('cadence')) {
    const cadenceFromCrank = createCrankCadenceCalculator();
    monitorCharacteristic(
      active,
      sensor,
      CSC_SERVICE,
      CSC_MEASUREMENT,
      'speed and cadence',
      (value) => {
        const parsed = parseCsc(base64ToBytes(value));
        if (parsed?.crank) {
          const rpm = cadenceFromCrank.update(parsed.crank, Date.now());
          if (rpm != null) store().setLatest('cadence', rpm, sensor.id);
        }
      }
    );
  }

  if (kinds.includes('runningCadence')) {
    monitorCharacteristic(
      active,
      sensor,
      RSC_SERVICE,
      RSC_MEASUREMENT,
      'running speed and cadence',
      (value) => applyRscFrame(sensor.id, base64ToBytes(value))
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

/**
 * How a connect is made. `direct` has a 10 s timeout, so a sensor that is not
 * nearby is reported. `pending` has none and is left with the platform, which
 * completes it when the sensor is next in range: Android's `autoConnect`, and
 * on iOS the untimed connect, which CoreBluetooth keeps pending.
 */
type ConnectMode = 'direct' | 'pending';

/**
 * What a connect asks the stack for. `freshTable` is for a reconnect that
 * follows silence: Android otherwise answers discovery from its GATT cache,
 * so a service table that changed since the cache was built is never re-read.
 * iOS discovers afresh on every connect, so the request is Android's alone.
 */
interface ConnectRequest {
  mode: ConnectMode;
  freshTable: boolean;
}

function connectOptions({ mode, freshTable }: ConnectRequest): ConnectionOptions {
  const options: ConnectionOptions = {};
  if (mode === 'direct') options.timeout = 10_000;
  else if (Platform.OS === 'android') options.autoConnect = true;
  if (freshTable && Platform.OS === 'android') options.refreshGatt = 'OnConnected';
  return options;
}

function isTimeout(error: unknown): boolean {
  return (error as { errorCode?: number } | null)?.errorCode === BleErrorCode.OperationTimedOut;
}

async function connectAndSubscribe(
  sensor: KnownSensor,
  attempt: number,
  mode: ConnectMode = 'direct',
  { freshTable = false }: { freshTable?: boolean } = {}
): Promise<void> {
  const ble = getBle();
  if (!ble) return;

  const existing = activeConnections.get(sensor.id);
  if (existing && !existing.cancelled) return;

  const pending = attempt === 0 ? 'connecting' : 'reconnecting';
  useSensorStore.getState().setConnection(sensor.id, {
    status: pending,
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
    const connectStartedAt = Date.now();
    traceLink(sensor, 'connectStart');
    const options = connectOptions({ mode, freshTable });
    const device = await ble.connectToDevice(sensor.id, options);
    const connectedAt = Date.now();
    traceLink(sensor, 'connected', { ms: connectedAt - connectStartedAt });
    if (superseded()) {
      abandonConnect(sensor.id);
      return;
    }
    await device.discoverAllServicesAndCharacteristics();
    traceLink(sensor, 'discovered', {
      ms: Date.now() - connectedAt,
      detail: options.refreshGatt ? 'refreshed' : undefined,
    });
    if (superseded()) {
      abandonConnect(sensor.id);
      return;
    }

    const active: ActiveConnection = {
      sensor,
      device,
      monitors: [],
      subscriptions: [],
      disconnectSub: null,
      cancelled: false,
      attempt: attempt === 0 ? 'first' : 'retry',
      subscribedAt: null,
      lastSampleAt: null,
      healthTimer: null,
    };
    activeConnections.set(sensor.id, active);

    active.disconnectSub = ble.onDeviceDisconnected(sensor.id, () => {
      log.warn(`Sensor disconnected: ${sensor.name}`);
      traceLink(sensor, 'disconnected');
      cleanupConnection(sensor.id, { keepStoreEntry: true });
      const conn = useSensorStore.getState().connections[sensor.id];
      if (conn) pendReconnect(sensor);
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
    // A cancelled connect rejects; whoever cancelled it has already moved on.
    if (superseded()) return;
    log.warn(`Failed to connect ${sensor.name}:`, e);
    if (noteBleError(e)) {
      scheduleReconnect(sensor, attempt + 1);
    } else if (mode === 'direct' && isTimeout(e)) {
      seekSensor(sensor);
    } else {
      scheduleReconnect(sensor, attempt + 1);
    }
  }
}

/**
 * After a drop, hand the sensor to one connect the platform holds. Outside a
 * session nothing needs the link, so it ends instead.
 */
function pendReconnect(sensor: KnownSensor, { freshTable = false } = {}): void {
  if (!useSensorStore.getState().connections[sensor.id]) return;
  if (!sessionOwnsConnections()) {
    log.log(`Sensor link ended outside a recording session: ${sensor.name}`);
    cleanupConnection(sensor.id);
    pairingConnections.delete(sensor.id);
    return;
  }
  useSensorStore.getState().setConnectionStatus(sensor.id, 'reconnecting');
  if (radioBlocksConnect()) {
    parkSensor(sensor);
    return;
  }
  traceLink(sensor, 'reconnectPending', { detail: Platform.OS });
  void connectAndSubscribe(sensor, 1, 'pending', { freshTable });
}

/**
 * Sensors a direct connect could not find. Android's pending connect completes
 * only for a device the stack has an address type for, one bonded or seen by a
 * scan since boot, so a filtered scan runs until each is seen and the connect
 * is pended then. A scan is bounded by the session: ending the sensor's link
 * removes it from here.
 */
const seeking = new Map<string, KnownSensor>();
/** Whether the scan running now was started for `seeking`, as opposed to the athlete's scan. */
let seekScanActive = false;

function seekSensor(sensor: KnownSensor): void {
  if (!useSensorStore.getState().connections[sensor.id]) return;
  useSensorStore.getState().setConnectionStatus(sensor.id, 'reconnecting');
  traceLink(sensor, 'seeking');
  seeking.set(sensor.id, sensor);
  startSeekScan();
}

function startSeekScan(): void {
  const ble = bleManager;
  if (!ble || seeking.size === 0 || seekScanActive) return;
  seekScanActive = true;
  ble.startDeviceScan(SCANNED_SERVICES, { allowDuplicates: false }, (error, device) => {
    if (error) {
      log.warn('Sensor search scan error:', error.message);
      noteBleError(error);
      seekScanActive = false;
      ble.stopDeviceScan();
      // Without a scan the timed retry is what is left.
      const lost = [...seeking.values()];
      seeking.clear();
      for (const sensor of lost) scheduleReconnect(sensor, 1);
      return;
    }
    if (device) noteSeen(device.id);
  });
}

/** A sensor was advertised: pend the connect of one being looked for. */
function noteSeen(id: string): void {
  const sensor = seeking.get(id);
  if (!sensor) return;
  seeking.delete(id);
  stopSeekScanIfIdle();
  if (!useSensorStore.getState().connections[id]) return;
  traceLink(sensor, 'reconnectPending', { detail: Platform.OS });
  void connectAndSubscribe(sensor, 1, 'pending');
}

function stopSeekScanIfIdle(): void {
  if (seeking.size > 0 || !seekScanActive) return;
  seekScanActive = false;
  bleManager?.stopDeviceScan();
}

/**
 * Publishes the link's health and reads its signal. A link that has carried
 * nothing reads as no data and stays subscribed: tearing it down writes the
 * CCCD off and on over a link another client may share, and a peripheral that
 * starts notifying late is heard by the subscription already in place. The
 * athlete's way to a fresh subscription is `reconnectSensor`.
 */
function watchdogTick(sensor: KnownSensor): void {
  const active = activeConnections.get(sensor.id);
  if (!active || active.cancelled) return;
  publishHealth(sensor, active);
  readSignal(sensor.id, active);
}

/** End a paired sensor's link and connect it again at once, for a link that reads no data. */
export async function reconnectSensor(id: string): Promise<void> {
  const sensor = useSensorStore.getState().knownSensors.find((s) => s.id === id);
  if (!sensor) return;
  cleanupConnection(id, { keepStoreEntry: true });
  try {
    await bleManager?.cancelDeviceConnection(id);
  } catch {
    // Already gone, which is the outcome wanted.
  }
  await connectAndSubscribe(sensor, 0, 'direct', { freshTable: true });
}

/**
 * The received signal strength of an open link, for the row that shows it. A
 * failed read leaves the last reading, since the watchdog is what judges the
 * link.
 */
function readSignal(id: string, active: ActiveConnection): void {
  void Promise.resolve()
    .then(() => active.device.readRSSI())
    .then((device) => {
      if (active.cancelled || device.rssi == null) return;
      useSensorStore.getState().setSignal(id, device.rssi);
    })
    .catch(() => {
      // No reading this tick.
    });
}

/** Drop the device a superseded connect opened, so it does not stay connected. */
function abandonConnect(id: string): void {
  log.log(`Dropping a sensor connect that was disconnected while it was in flight: ${id}`);
  void bleManager?.cancelDeviceConnection(id).catch(() => {
    // Already gone, which is the outcome wanted.
  });
}

function scheduleReconnect(sensor: KnownSensor, attempt = 1, { freshTable = false } = {}): void {
  const conn = useSensorStore.getState().connections[sensor.id];
  if (!conn) return; // Disconnected deliberately
  // Outside a session nothing needs the link, so a drop ends it rather than
  // retrying for as long as the app runs.
  if (!sessionOwnsConnections()) {
    log.log(`Sensor link ended outside a recording session: ${sensor.name}`);
    cleanupConnection(sensor.id);
    pairingConnections.delete(sensor.id);
    return;
  }
  useSensorStore.getState().setConnectionStatus(sensor.id, 'reconnecting');
  if (radioBlocksConnect()) {
    parkSensor(sensor);
    return;
  }
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), RECONNECT_MAX_MS);
  traceLink(sensor, 'reconnectScheduled', { ms: delay });
  const timer = setTimeout(() => {
    reconnectTimers.delete(sensor.id);
    // Still wanted? (disconnectSensor removes the store entry)
    if (!useSensorStore.getState().connections[sensor.id]) return;
    void connectAndSubscribe(sensor, attempt, 'direct', { freshTable });
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
  traceLink(sensor, 'parked');
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
  if (seeking.delete(id)) stopSeekScanIfIdle();
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
    for (const link of active.monitors) {
      traceLink(active.sensor, 'sampleCount', {
        characteristic: link.characteristic,
        count: link.samples,
      });
    }
    traceLink(active.sensor, 'teardown');
  }
  if (!options?.keepStoreEntry) {
    useSensorStore.getState().setConnection(id, null);
    useSensorStore.getState().dropSources(id);
  }
}

/**
 * Keep the paired sensors connected while the holder is open. Taking a hold
 * cancels a pending release, which is how the recording screen takes the
 * entry screen's connections over without a reconnect.
 */
export function holdSensors(holder: SensorHolder): void {
  holders.add(holder);
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

/** Whether the holder still holds the sensors, for a connect that awaited a permission. */
export function holdsSensors(holder: SensorHolder): boolean {
  return holders.has(holder);
}

/**
 * Let go of a hold. Once nothing holds the sensors and no ride is under way,
 * they are disconnected, after `SENSOR_RELEASE_GRACE_MS` unless `immediate`,
 * and the sensors disconnected for the session are forgotten with them.
 */
export function releaseSensors(holder: SensorHolder, options?: { immediate?: boolean }): void {
  if (!holders.delete(holder) || holders.size > 0) return;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  const release = () => {
    releaseTimer = null;
    if (holders.size > 0 || useRecordingStore.getState().status !== 'idle') return;
    stopSimulatedSensors();
    void disconnectAllSensors();
  };
  const nothingConnected =
    activeConnections.size === 0 && Object.keys(useSensorStore.getState().connections).length === 0;
  if (options?.immediate || nothingConnected) release();
  else releaseTimer = setTimeout(release, SENSOR_RELEASE_GRACE_MS);
}

/**
 * Connect every paired sensor the athlete has not disconnected for this
 * session. With no hold taken it holds them for the recording session, and
 * `disconnectAllSensors` ends it.
 */
export async function connectKnownSensors(): Promise<void> {
  if (holders.size === 0) holdSensors('session');
  pairingConnections.clear();
  const { knownSensors } = useSensorStore.getState();
  for (const sensor of knownSensors) {
    if (droppedForSession.has(sensor.id)) continue;
    connectAndSubscribe(sensor, 0);
  }
}

/** Disconnect one paired sensor for the rest of the session, keeping its pairing. */
export async function dropSensorForSession(id: string): Promise<void> {
  droppedForSession.add(id);
  await disconnectSensor(id);
}

/** Connect again a paired sensor the athlete disconnected for this session. */
export async function connectSensorForSession(id: string): Promise<void> {
  droppedForSession.delete(id);
  const sensor = useSensorStore.getState().knownSensors.find((s) => s.id === id);
  if (sensor) await connectAndSubscribe(sensor, 0);
}

/**
 * Connect the one sensor being paired, so the Sensors screen can show it
 * working. `releasePairingConnections` ends it when the screen is left.
 */
export async function connectPairedSensor(sensor: KnownSensor): Promise<void> {
  if (!sessionOwnsConnections()) pairingConnections.add(sensor.id);
  await connectAndSubscribe(sensor, 0);
}

/**
 * Disconnect what the Sensors screen connected, unless a recording session
 * owns the connections and keeps them.
 */
export async function releasePairingConnections(): Promise<void> {
  const ids = [...pairingConnections];
  pairingConnections.clear();
  if (sessionOwnsConnections()) return;
  for (const id of ids) {
    await disconnectSensor(id);
  }
}

export async function disconnectSensor(id: string): Promise<void> {
  pairingConnections.delete(id);
  cleanupConnection(id);
  try {
    await bleManager?.cancelDeviceConnection(id);
  } catch {
    // Already disconnected
  }
}

export async function disconnectAllSensors(): Promise<void> {
  holders.clear();
  droppedForSession.clear();
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  const ids = [...activeConnections.keys()];
  const storeIds = Object.keys(useSensorStore.getState().connections);
  for (const id of new Set([...ids, ...storeIds])) {
    await disconnectSensor(id);
  }
}
