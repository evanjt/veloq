/**
 * Scenario: two paired sensors supply the same metric, a power meter working
 * cadence out from its crank and a dedicated cadence sensor, or two heart rate
 * straps. Every notification from either wrote the one live sample, so the
 * recorded stream alternated between the two.
 *
 * Expected behaviour: one source per metric. The athlete's choice wins, then a
 * dedicated sensor over a derived value, then the sensor paired first, and a
 * source that goes quiet hands over to the next until it sends again.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  CSC_SERVICE,
  CYCLING_POWER_SERVICE,
  HEART_RATE_SERVICE,
} from '@/features/sensors/lib/gatt';
import { connectKnownSensors, disconnectAllSensors } from '@/features/sensors/lib/sensorManager';
import type { KnownSensor } from '@/features/sensors/types';

const mockConnectToDevice = jest.fn();

/** The monitor callbacks the manager registered, by sensor and service. */
const monitors = new Map<string, (error: unknown, characteristic: unknown) => void>();

function mockDeviceFor(id: string) {
  return {
    id,
    discoverAllServicesAndCharacteristics: jest.fn(async () => undefined),
    monitorCharacteristicForService: jest.fn(
      (service: string, _characteristic: string, cb: (e: unknown, c: unknown) => void) => {
        monitors.set(`${id}:${service}`, cb);
        return { remove: jest.fn() };
      }
    ),
    readCharacteristicForService: jest.fn(async () => ({ value: null })),
  };
}

jest.mock('react-native-ble-plx', () => ({
  ...jest.requireActual('react-native-ble-plx'),
  BleManager: jest.fn(() => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: jest.fn(async () => undefined),
    onDeviceDisconnected: jest.fn(() => ({ remove: jest.fn() })),
    onStateChange: jest.fn(() => ({ remove: jest.fn() })),
    stopDeviceScan: jest.fn(),
  })),
}));

// The manager constructs nothing unless the build carries the native module.
require('react-native').NativeModules.BlePlx = {};

const POWER_METER: KnownSensor = { id: 'crank-meter', name: 'Crank meter', kinds: ['power'] };
const CADENCE_POD: KnownSensor = { id: 'cadence-pod', name: 'Cadence pod', kinds: ['cadence'] };
const FIRST_STRAP: KnownSensor = { id: 'strap-a', name: 'Strap A', kinds: ['heartRate'] };
const SECOND_STRAP: KnownSensor = { id: 'strap-b', name: 'Strap B', kinds: ['heartRate'] };

const base64 = (bytes: number[]) => ({ value: Buffer.from(bytes).toString('base64') });
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

/** Cycling power with crank data: flags 0x20, power, revolutions, event time. */
const powerFrame = (watts: number, revs: number, time1024: number) =>
  base64([...u16(0x0020), ...u16(watts), ...u16(revs), ...u16(time1024)]);
/** Speed and cadence with crank data only: flags 0x02, revolutions, event time. */
const cscFrame = (revs: number, time1024: number) => base64([0x02, ...u16(revs), ...u16(time1024)]);
const heartRateFrame = (bpm: number) => base64([0x00, bpm]);

/** One crank revolution in this many 1/1024 s ticks reads as the rpm wanted. */
const ticksFor = (rpm: number) => Math.round((60 * 1024) / rpm);

/** Each sensor's crank counters, so every frame is one more revolution. */
function crank(rpm: number) {
  let revs = 0;
  let time = 0;
  return () => {
    revs += 1;
    time = (time + ticksFor(rpm)) & 0xffff;
    return { revs, time };
  };
}

function send(sensorId: string, service: string, frame: { value: string }): void {
  const monitor = monitors.get(`${sensorId}:${service}`);
  if (!monitor) throw new Error(`no monitor for ${sensorId} on ${service}`);
  monitor(null, frame);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function pair(sensors: KnownSensor[]): Promise<void> {
  useSensorStore.setState({ knownSensors: sensors, connections: {} });
  void connectKnownSensors();
  await settle();
}

const liveCadence = () => useRecordingStore.getState().latestSensor.cadence?.value;
const liveHeartRate = () => useRecordingStore.getState().latestSensor.heartrate?.value;

beforeEach(async () => {
  jest.useFakeTimers();
  await disconnectAllSensors();
  jest.clearAllMocks();
  monitors.clear();
  mockConnectToDevice.mockImplementation(async (id: string) => mockDeviceFor(id));
  useRecordingStore.setState({ latestSensor: { heartrate: null, power: null, cadence: null } });
});

afterEach(async () => {
  await disconnectAllSensors();
  useSensorStore.setState({ knownSensors: [], connections: {} });
  jest.useRealTimers();
});

describe('cadence from a power meter and a cadence sensor', () => {
  /**
   * Alternate the two, the meter at 85 rpm and the pod at 92, reading cadence
   * after each. A crank's first frame only primes it, so each sends two
   * before anything is read.
   */
  function alternate(rounds: number): number[] {
    const meter = crank(85);
    const pod = crank(92);
    const sendMeter = () => {
      const m = meter();
      send(POWER_METER.id, CYCLING_POWER_SERVICE, powerFrame(200, m.revs, m.time));
    };
    const sendPod = () => {
      const p = pod();
      send(CADENCE_POD.id, CSC_SERVICE, cscFrame(p.revs, p.time));
    };
    for (let i = 0; i < 2; i++) {
      sendMeter();
      sendPod();
    }
    const seen: number[] = [];
    for (let i = 0; i < rounds; i++) {
      jest.advanceTimersByTime(500);
      sendMeter();
      seen.push(liveCadence()!);
      jest.advanceTimersByTime(500);
      sendPod();
      seen.push(liveCadence()!);
    }
    return seen;
  }

  it('records the dedicated cadence sensor over the crank meter paired before it', async () => {
    await pair([POWER_METER, CADENCE_POD]);

    expect(alternate(4)).toEqual(Array(8).fill(92));
    expect(useSensorStore.getState().activeSources.cadence).toBe(CADENCE_POD.id);
  });

  it('records the power meter when the athlete chose it for cadence', async () => {
    await pair([{ ...POWER_METER, preferredFor: ['cadence'] }, CADENCE_POD]);

    expect(alternate(4)).toEqual(Array(8).fill(85));
    expect(useSensorStore.getState().activeSources.cadence).toBe(POWER_METER.id);
  });

  it('still records the power meter as the power source', async () => {
    await pair([POWER_METER, CADENCE_POD]);
    alternate(2);

    expect(useRecordingStore.getState().latestSensor.power?.value).toBe(200);
    expect(useSensorStore.getState().activeSources.power).toBe(POWER_METER.id);
  });

  it('falls back to the crank meter once the cadence sensor goes quiet, and back again', async () => {
    await pair([POWER_METER, CADENCE_POD]);
    alternate(3);
    expect(liveCadence()).toBe(92);

    // The pod stops; the meter carries on once a second.
    const meter = crank(85);
    send(POWER_METER.id, CYCLING_POWER_SERVICE, powerFrame(200, 0, 0));
    for (let i = 0; i < 8; i++) {
      jest.advanceTimersByTime(1000);
      const m = meter();
      send(POWER_METER.id, CYCLING_POWER_SERVICE, powerFrame(200, m.revs, m.time));
    }
    expect(liveCadence()).toBe(85);
    expect(useSensorStore.getState().activeSources.cadence).toBe(POWER_METER.id);

    // The pod's first frame primes its crank, the second carries a value.
    send(CADENCE_POD.id, CSC_SERVICE, cscFrame(100, 0));
    send(CADENCE_POD.id, CSC_SERVICE, cscFrame(101, ticksFor(92)));
    expect(liveCadence()).toBe(92);
    expect(useSensorStore.getState().activeSources.cadence).toBe(CADENCE_POD.id);
  });
});

describe('heart rate from two straps', () => {
  it('records the strap paired first while both send', async () => {
    await pair([FIRST_STRAP, SECOND_STRAP]);

    for (let i = 0; i < 4; i++) {
      jest.advanceTimersByTime(500);
      send(FIRST_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(140));
      expect(liveHeartRate()).toBe(140);
      jest.advanceTimersByTime(500);
      send(SECOND_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(150));
      expect(liveHeartRate()).toBe(140);
    }
    expect(useSensorStore.getState().activeSources.heartRate).toBe(FIRST_STRAP.id);
  });

  it('hands over to the second strap only once the first goes quiet', async () => {
    await pair([FIRST_STRAP, SECOND_STRAP]);
    send(FIRST_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(140));

    // Within the stale window the first strap still holds the metric.
    jest.advanceTimersByTime(3000);
    send(SECOND_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(150));
    expect(liveHeartRate()).toBe(140);

    jest.advanceTimersByTime(3000);
    send(SECOND_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(151));
    expect(liveHeartRate()).toBe(151);
    expect(useSensorStore.getState().activeSources.heartRate).toBe(SECOND_STRAP.id);

    send(FIRST_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(142));
    expect(liveHeartRate()).toBe(142);
    send(SECOND_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(152));
    expect(liveHeartRate()).toBe(142);
  });

  it('records the strap the athlete chose over the one paired first', async () => {
    await pair([FIRST_STRAP, { ...SECOND_STRAP, preferredFor: ['heartRate'] }]);

    send(FIRST_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(140));
    send(SECOND_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(150));
    send(FIRST_STRAP.id, HEART_RATE_SERVICE, heartRateFrame(141));
    expect(liveHeartRate()).toBe(150);
  });
});
