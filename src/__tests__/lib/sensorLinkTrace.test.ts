/**
 * Scenario: a strap connects, accepts its subscription and sends nothing, on a
 * release build where every sensor log line is stripped.
 *
 * Expected behaviour: each link's connect, monitor registration, monitor error,
 * first sample, watchdog and teardown survive in memory as one report the
 * debug screen reads, after the ride has been discarded.
 */

import { useSensorStore } from '@/features/sensors/store';
import { HEART_RATE_MEASUREMENT } from '@/features/sensors/lib/gatt';
import { SENSOR_NO_DATA_MS } from '@/features/sensors/lib/connectionHealth';
import { connectKnownSensors, disconnectAllSensors } from '@/features/sensors/lib/sensorManager';
import {
  SENSOR_LINK_TRACE_CAPACITY,
  clearSensorLinkTrace,
  createSensorLinkTrace,
  formatSensorLinkEvent,
  readSensorLinkReport,
  sensorLinkEvents,
} from '@/features/sensors/lib/sensorLinkTrace';

const mockCancelDeviceConnection = jest.fn(async () => undefined);
const mockConnectToDevice = jest.fn();

/** The newest monitor callback the manager registered, so a test can deliver to it. */
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

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: mockCancelDeviceConnection,
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

// The manager constructs nothing unless the build carries the native module.
require('react-native').NativeModules.BlePlx = {};

const SENSOR = { id: 'kite-7', name: 'Kite tether', kinds: ['heartRate' as const] };

/** A 72 bpm measurement: flags byte 0, then the 8-bit rate. */
const HEART_RATE_72 = { value: Buffer.from([0x00, 72]).toString('base64') };

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function kinds(): string[] {
  return sensorLinkEvents().map((event) => event.kind);
}

describe('createSensorLinkTrace', () => {
  it('keeps only its capacity, dropping the oldest', () => {
    const trace = createSensorLinkTrace(3);
    for (let i = 0; i < 5; i++) {
      trace.record({ sensorId: `s${i}`, sensorName: `S${i}`, kind: 'connectStart' }, 1_000 + i);
    }

    expect(trace.events().map((event) => event.sensorId)).toEqual(['s2', 's3', 's4']);
  });

  it('holds a few rides of reconnect loops by default', () => {
    const trace = createSensorLinkTrace();
    for (let i = 0; i < SENSOR_LINK_TRACE_CAPACITY + 10; i++) {
      trace.record({ sensorId: 'a', sensorName: 'A', kind: 'teardown' }, i);
    }

    expect(trace.events()).toHaveLength(SENSOR_LINK_TRACE_CAPACITY);
    expect(trace.events()[0].at).toBe(10);
  });

  it('times a line from the oldest event and names the sensor, characteristic and figures', () => {
    const line = formatSensorLinkEvent(
      {
        at: 13_500,
        sensorId: 'kite-7',
        sensorName: 'Kite tether',
        kind: 'firstSample',
        characteristic: '2a37',
        ms: 500,
      },
      1_000
    );

    expect(line).toBe('+12500ms Kite tether firstSample 2a37 500ms');
  });

  it('carries the count and the reason when there are ones', () => {
    expect(
      formatSensorLinkEvent(
        {
          at: 0,
          sensorId: 'a',
          sensorName: 'A',
          kind: 'sampleCount',
          characteristic: 'c',
          count: 4,
        },
        0
      )
    ).toBe('+0ms A sampleCount c x4');
    expect(
      formatSensorLinkEvent(
        { at: 0, sensorId: 'a', sensorName: 'A', kind: 'monitorError', detail: 'gone' },
        0
      )
    ).toBe('+0ms A monitorError (gone)');
  });

  it('reports nothing before any link has been opened', () => {
    clearSensorLinkTrace();
    expect(readSensorLinkReport()).toBeNull();
  });
});

describe('the sensor link trace on a silent strap', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await disconnectAllSensors();
    jest.clearAllMocks();
    clearSensorLinkTrace();
    deliver = null;
    mockConnectToDevice.mockResolvedValue(mockDevice);
    useSensorStore.setState({ knownSensors: [SENSOR], connections: {} });
  });

  afterEach(async () => {
    await disconnectAllSensors();
    jest.useRealTimers();
  });

  it('records the registration, the watchdog, the teardown, the reconnect and the late first sample', async () => {
    void connectKnownSensors();
    await settle();

    expect(kinds()).toEqual(['connectStart', 'connected', 'discovered', 'monitorRegistered']);
    expect(sensorLinkEvents()[3]).toMatchObject({
      sensorId: SENSOR.id,
      sensorName: SENSOR.name,
      characteristic: HEART_RATE_MEASUREMENT,
    });

    jest.advanceTimersByTime(SENSOR_NO_DATA_MS);
    const watchdog = sensorLinkEvents().find((event) => event.kind === 'watchdogFired');
    expect(watchdog?.ms).toBe(SENSOR_NO_DATA_MS);
    expect(kinds().slice(4)).toEqual([
      'watchdogFired',
      'sampleCount',
      'teardown',
      'reconnectScheduled',
    ]);
    expect(sensorLinkEvents().find((event) => event.kind === 'sampleCount')?.count).toBe(0);
    const delay = sensorLinkEvents().find((event) => event.kind === 'reconnectScheduled')?.ms;
    expect(delay).toBeGreaterThan(0);

    jest.advanceTimersByTime(delay ?? 0);
    await settle();
    jest.advanceTimersByTime(2_000);
    deliver?.(null, HEART_RATE_72);
    deliver?.(null, HEART_RATE_72);

    const firsts = sensorLinkEvents().filter((event) => event.kind === 'firstSample');
    expect(firsts).toHaveLength(1);
    expect(firsts[0]).toMatchObject({ characteristic: HEART_RATE_MEASUREMENT, ms: 2_000 });

    const report = readSensorLinkReport() ?? '';
    expect(report).toContain(`Kite tether monitorRegistered ${HEART_RATE_MEASUREMENT}`);
    expect(report).toContain(`watchdogFired ${SENSOR_NO_DATA_MS}ms`);
    expect(report).toContain(`firstSample ${HEART_RATE_MEASUREMENT} 2000ms`);
  });

  it('counts each sample on teardown', async () => {
    void connectKnownSensors();
    await settle();
    deliver?.(null, HEART_RATE_72);
    deliver?.(null, HEART_RATE_72);
    deliver?.(null, HEART_RATE_72);

    await disconnectAllSensors();

    const count = sensorLinkEvents().find((event) => event.kind === 'sampleCount');
    expect(count).toMatchObject({ characteristic: HEART_RATE_MEASUREMENT, count: 3 });
    expect(kinds().at(-1)).toBe('teardown');
  });

  it('carries the characteristic and the message of a monitor error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    void connectKnownSensors();
    await settle();

    deliver?.({ message: 'Characteristic notification failed' }, null);

    expect(sensorLinkEvents().find((event) => event.kind === 'monitorError')).toMatchObject({
      characteristic: HEART_RATE_MEASUREMENT,
      detail: 'Characteristic notification failed',
    });
    expect(readSensorLinkReport()).toContain(
      `monitorError ${HEART_RATE_MEASUREMENT} (Characteristic notification failed)`
    );
    warn.mockRestore();
  });

  it('keeps the trace after the session ends, so it can be read after the ride', async () => {
    void connectKnownSensors();
    await settle();

    await disconnectAllSensors();

    expect(readSensorLinkReport()).toContain('Kite tether connectStart');
  });
});
