import {
  distinctLabels,
  isUnnamed,
  nearestFirst,
  sessionSensorRows,
  shortSensorId,
  signalLevel,
} from '@/features/sensors/lib/sensorRows';
import type { DiscoveredSensor } from '@/features/sensors/types';

const found = (id: string, rssi: number | null): DiscoveredSensor => ({
  id,
  name: 'Strap',
  kinds: ['heartRate'],
  rssi,
});

it('reads signal bars at each boundary and none without a reading', () => {
  expect(signalLevel(-60)).toBe(3);
  expect(signalLevel(-61)).toBe(2);
  expect(signalLevel(-75)).toBe(2);
  expect(signalLevel(-76)).toBe(1);
  expect(signalLevel(-110)).toBe(1);
  expect(signalLevel(null)).toBeNull();
  expect(signalLevel(Number.NaN)).toBeNull();
});

it('orders nearest first, keeps ties in arrival order and puts no reading last', () => {
  const order = nearestFirst([
    found('none', null),
    found('alsoNone', null),
    found('far', -85),
    found('tieA', -60),
    found('tieB', -60),
    found('near', -40),
  ]).map((s) => s.id);
  expect(order).toEqual(['near', 'tieA', 'tieB', 'far', 'none', 'alsoNone']);
  expect(nearestFirst([])).toEqual([]);
});

it('treats a name that is the device id, or blank, as no name', () => {
  expect(isUnnamed({ id: 'AA:BB', name: 'AA:BB' })).toBe(true);
  expect(isUnnamed({ id: 'AA:BB', name: '  ' })).toBe(true);
  expect(isUnnamed({ id: 'AA:BB', name: 'Strap' })).toBe(false);
});

it('shortens a MAC address and a UUID to their last four characters', () => {
  expect(shortSensorId('aa:bb:cc:dd:ee:0f')).toBe('EE0F');
  expect(shortSensorId('1B2C3D4E-0000-4000-8000-00000000A1B2')).toBe('A1B2');
});

it('adds the short id only to labels another row shares', () => {
  const labels = distinctLabels([
    { id: 'aa:01:02', label: 'Strap' },
    { id: 'aa:03:04', label: 'Strap' },
    { id: 'aa:05:06', label: 'Meter' },
  ]);
  expect([...labels.values()]).toEqual(['Strap · 0102', 'Strap · 0304', 'Meter']);
});

describe('sessionSensorRows', () => {
  const strap = { id: 'strap-1', name: 'Chest strap', kinds: ['heartRate' as const] };
  const meter = { id: 'meter-1', name: 'Crank meter', kinds: ['power' as const] };
  const idleSamples = { heartrate: null, power: null, cadence: null };

  it('lists every paired sensor in pairing order, off when it has no link', () => {
    const rows = sessionSensorRows({
      knownSensors: [strap, meter],
      connections: {},
      activeSources: {},
      suppliedKinds: {},
      latestSensor: idleSamples,
    });

    expect(rows.map((r) => [r.id, r.state, r.signal, r.batteryPercent])).toEqual([
      ['strap-1', 'off', null, null],
      ['meter-1', 'off', null, null],
    ]);
  });

  it('is empty with nothing paired, whatever is connected', () => {
    const rows = sessionSensorRows({
      knownSensors: [],
      connections: { 'simulated-sensors': { status: 'connected', name: 'x', kinds: [] } },
      activeSources: {},
      suppliedKinds: {},
      latestSensor: idleSamples,
    });
    expect(rows).toEqual([]);
  });

  it('carries the link state, battery and signal bars', () => {
    const rows = sessionSensorRows({
      knownSensors: [strap, meter],
      connections: {
        'strap-1': {
          status: 'connected',
          name: strap.name,
          kinds: strap.kinds,
          batteryPercent: 64,
          rssi: -52,
        },
        'meter-1': { status: 'reconnecting', name: meter.name, kinds: meter.kinds, rssi: -90 },
      },
      activeSources: {},
      suppliedKinds: {},
      latestSensor: idleSamples,
    });

    expect(rows.map((r) => [r.state, r.batteryPercent, r.signal])).toEqual([
      ['connected', 64, 3],
      ['reconnecting', null, 1],
    ]);
  });

  it('shows a value only on the connected sensor the metric is recorded from', () => {
    const second = { id: 'strap-2', name: 'Arm band', kinds: ['heartRate' as const] };
    const rows = sessionSensorRows({
      knownSensors: [strap, second, meter],
      connections: {
        'strap-1': { status: 'connected', name: strap.name, kinds: strap.kinds },
        'strap-2': { status: 'connected', name: second.name, kinds: second.kinds },
        'meter-1': { status: 'noData', name: meter.name, kinds: meter.kinds },
      },
      activeSources: { heartRate: 'strap-1', power: 'meter-1', cadence: 'meter-1' },
      suppliedKinds: { 'meter-1': ['power', 'cadence'] },
      latestSensor: { heartrate: { value: 141 }, power: { value: 212 }, cadence: { value: 88 } },
    });

    expect(rows.map((r) => r.live)).toEqual([[{ kind: 'heartRate', value: 141 }], [], []]);
  });

  it('includes the cadence a power meter has been seen supplying', () => {
    const rows = sessionSensorRows({
      knownSensors: [meter],
      connections: { 'meter-1': { status: 'connected', name: meter.name, kinds: meter.kinds } },
      activeSources: { power: 'meter-1', cadence: 'meter-1' },
      suppliedKinds: { 'meter-1': ['power', 'cadence'] },
      latestSensor: { heartrate: null, power: { value: 212 }, cadence: { value: 88 } },
    });

    expect(rows[0].live).toEqual([
      { kind: 'power', value: 212 },
      { kind: 'cadence', value: 88 },
    ]);
  });
});
