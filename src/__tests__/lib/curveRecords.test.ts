/**
 * Scenario: the curve bodies were parsed in TypeScript, with `JSON.parse` on
 * every stats mount and every sync completion. The engine parses them now
 * (`persistence/curves.rs`), so what is left here is naming: the charts read
 * `watts_per_kg` and a model's `type`, the record calls them `wattsPerKg` and
 * `kind`.
 *
 * Expected behaviour: nothing the body carried is dropped on the way to the
 * chart, and no curve path parses JSON.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { paceCurveOf, powerCurveOf } from '@/features/stats/lib/curveRecords';
import type { PaceCurveRow, PowerCurveRow } from 'veloqrs';

const ROOT = join(__dirname, '../../..');

const ACTIVITY = {
  id: 'i2',
  name: 'Hill repeats',
  distance: 12000,
  movingTime: 2400,
  trainingLoad: 60,
  weight: 79.1,
  startDateLocal: '2026-07-02T07:00:00',
  race: true,
};

const POWER: PowerCurveRow = {
  sport: 'Ride',
  secs: [1, 2, 5],
  watts: [568, 547, 500],
  wattsPerKg: [7.194518, 6.9285235, 6.33],
  activityIds: ['i1', 'i1', 'i2'],
  wkgActivityIds: ['i1', 'i1', 'i2'],
  weight: 78.949,
  models: [
    { kind: 'MS_2P', criticalPower: 119, wPrime: 12799, ftp: 119 },
    { kind: 'MORTON_3P', criticalPower: 118, wPrime: 12800, ftp: 118, pMax: 568 },
  ],
  activities: { i2: ACTIVITY },
  startDate: '2026-06-08T00:00:00',
  endDate: '2026-09-06T00:00:00',
  days: 91,
  fetchedAt: 1_757_000_000_000,
};

const PACE: PaceCurveRow = {
  sport: 'Run',
  distances: [100],
  times: [20],
  pace: [5],
  activityIds: ['i3'],
  activities: { i2: ACTIVITY },
  criticalSpeed: 3.1,
  dPrime: 150,
  r2: 0.99,
  startDate: '2026-06-08T00:00:00',
  endDate: '2026-09-06T00:00:00',
  days: 91,
  fetchedAt: 1_757_000_000_000,
};

describe('a power curve on its way to the chart', () => {
  const curve = powerCurveOf(POWER);

  it('keeps the series, the per-kilogram series and the weight behind it', () => {
    expect(curve.secs).toEqual([1, 2, 5]);
    expect(curve.watts).toEqual([568, 547, 500]);
    expect(curve.watts_per_kg).toEqual([7.194518, 6.9285235, 6.33]);
    expect(curve.wkg_activity_ids).toEqual(['i1', 'i1', 'i2']);
    expect(curve.weight).toBe(78.949);
  });

  it('names a model by the key the chart reads', () => {
    expect(curve.models?.map((m) => m.type)).toEqual(['MS_2P', 'MORTON_3P']);
    expect(curve.models?.[0]).toEqual({
      type: 'MS_2P',
      criticalPower: 119,
      wPrime: 12799,
      ftp: 119,
    });
    expect(curve.models?.[1].pMax).toBe(568);
  });

  it('keeps every source activity, so a checkpoint has a date offline', () => {
    expect(curve.activities?.i2).toEqual(ACTIVITY);
  });

  it('keeps the window and says which sport it is', () => {
    expect(curve.startDate).toBe('2026-06-08T00:00:00');
    expect(curve.endDate).toBe('2026-09-06T00:00:00');
    expect(curve.days).toBe(91);
    expect(curve.type).toBe('power');
    expect(curve.sport).toBe('Ride');
  });

  it('carries a curve with none of the extras rather than nothing', () => {
    const bare = powerCurveOf({
      sport: 'Ride',
      secs: [1],
      watts: [500],
      models: [],
      activities: {},
      fetchedAt: 0,
    });

    expect(bare.watts).toEqual([500]);
    expect(bare.watts_per_kg).toBeUndefined();
    expect(bare.weight).toBeUndefined();
    expect(bare.models).toEqual([]);
  });
});

describe('a pace curve on its way to the chart', () => {
  const curve = paceCurveOf(PACE);

  it('keeps the critical-speed terms and the series', () => {
    expect(curve.distances).toEqual([100]);
    expect(curve.times).toEqual([20]);
    expect(curve.pace).toEqual([5]);
    expect(curve.criticalSpeed).toBe(3.1);
    expect(curve.dPrime).toBe(150);
    expect(curve.r2).toBe(0.99);
    expect(curve.type).toBe('pace');
  });

  it('keeps the source activities the same way', () => {
    expect(curve.activities?.i2.startDateLocal).toBe('2026-07-02T07:00:00');
  });
});

describe('the curve read path', () => {
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  it.each([
    'src/features/stats/lib/curveRecords.ts',
    'src/features/stats/hooks/usePowerCurve.ts',
    'src/features/stats/hooks/usePaceCurve.ts',
    'src/shared/app/GlobalDataSync.tsx',
  ])('parses no JSON in %s', (path) => {
    expect(read(path)).not.toMatch(/JSON\.parse/);
  });
});
