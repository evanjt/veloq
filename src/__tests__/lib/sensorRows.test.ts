import {
  distinctLabels,
  isUnnamed,
  nearestFirst,
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
