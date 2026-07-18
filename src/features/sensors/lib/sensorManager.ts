import { Platform, PermissionsAndroid } from 'react-native';

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
import type { KnownSensor, SensorKind } from '../types';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

const log = debug.create('Sensors');

const SCANNED_SERVICES = [HEART_RATE_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE];
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

let bleManager: BleManager | null = null;
let bleUnavailable = false;

/** Lazily create the BleManager; null when the native module is absent (Expo Go, tests). */
function getBle(): BleManager | null {
  if (bleManager) return bleManager;
  if (bleUnavailable) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BleManager: Manager } = require('react-native-ble-plx');
    bleManager = new Manager();
    return bleManager;
  } catch (e) {
    log.warn('BLE unavailable:', e);
    bleUnavailable = true;
    return null;
  }
}

export function isBleAvailable(): boolean {
  return getBle() !== null;
}

/** Android 12+ needs runtime BLUETOOTH_SCAN/CONNECT; older versions are manifest-only. */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 31) return true;
  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
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

export async function startScan(): Promise<void> {
  const ble = getBle();
  if (!ble) return;
  const store = useSensorStore.getState();
  store.clearDiscovered();
  store.setScanning(true);

  ble.startDeviceScan(SCANNED_SERVICES, { allowDuplicates: false }, (error, device) => {
    if (error) {
      log.warn('Scan error:', error.message);
      useSensorStore.getState().setScanning(false);
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
}

export function stopScan(): void {
  getBle()?.stopDeviceScan();
  useSensorStore.getState().setScanning(false);
}

// ─── Connections ──────────────────────────────────────────────────────────────

interface ActiveConnection {
  device: Device;
  subscriptions: Subscription[];
  disconnectSub: Subscription | null;
  cancelled: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const activeConnections = new Map<string, ActiveConnection>();

async function subscribeToSensor(active: ActiveConnection, kinds: SensorKind[]): Promise<void> {
  const { device } = active;
  const store = useSensorStore.getState;

  if (kinds.includes('heartRate')) {
    active.subscriptions.push(
      device.monitorCharacteristicForService(
        HEART_RATE_SERVICE,
        HEART_RATE_MEASUREMENT,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
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
          if (error || !characteristic?.value) return;
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
        if (error || !char?.value) return;
        const parsed = parseCsc(base64ToBytes(char.value));
        if (parsed?.crank) {
          const rpm = cadenceFromCrank.update(parsed.crank, Date.now());
          if (rpm != null) store().setLatest('cadence', rpm);
        }
      })
    );
  }

  // Battery is optional — read once, ignore absence
  try {
    const battery = await device.readCharacteristicForService(BATTERY_SERVICE, BATTERY_LEVEL);
    if (battery.value) {
      const percent = parseBatteryLevel(base64ToBytes(battery.value));
      if (percent != null) store().setBattery(device.id, percent);
    }
  } catch {
    // No battery service — fine
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

  try {
    const device = await ble.connectToDevice(sensor.id, { timeout: 10_000 });
    await device.discoverAllServicesAndCharacteristics();

    const active: ActiveConnection = {
      device,
      subscriptions: [],
      disconnectSub: null,
      cancelled: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
    };
    activeConnections.set(sensor.id, active);

    active.disconnectSub = ble.onDeviceDisconnected(sensor.id, () => {
      log.warn(`Sensor disconnected: ${sensor.name}`);
      cleanupConnection(sensor.id, { keepStoreEntry: true });
      const conn = useSensorStore.getState().connections[sensor.id];
      if (conn) scheduleReconnect(sensor);
    });

    await subscribeToSensor(active, sensor.kinds);
    useSensorStore.getState().setConnection(sensor.id, {
      status: 'connected',
      name: sensor.name,
      kinds: sensor.kinds,
    });
    log.log(`Sensor connected: ${sensor.name} (${sensor.kinds.join(', ')})`);
  } catch (e) {
    log.warn(`Failed to connect ${sensor.name}:`, e);
    scheduleReconnect(sensor, attempt + 1);
  }
}

function scheduleReconnect(sensor: KnownSensor, attempt = 1): void {
  const conn = useSensorStore.getState().connections[sensor.id];
  if (!conn) return; // Disconnected deliberately
  useSensorStore.getState().setConnectionStatus(sensor.id, 'reconnecting');
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6), RECONNECT_MAX_MS);
  setTimeout(() => {
    // Still wanted? (disconnectSensor removes the store entry)
    if (!useSensorStore.getState().connections[sensor.id]) return;
    connectAndSubscribe(sensor, attempt);
  }, delay);
}

function cleanupConnection(id: string, options?: { keepStoreEntry?: boolean }): void {
  const active = activeConnections.get(id);
  if (active) {
    active.cancelled = true;
    for (const sub of active.subscriptions) sub.remove();
    active.disconnectSub?.remove();
    if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
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
    await getBle()?.cancelDeviceConnection(id);
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
  useSensorStore.getState().clearLatest();
}
