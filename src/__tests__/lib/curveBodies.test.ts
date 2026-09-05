/**
 * Scenario: the power curve body the server sends carries twenty keys per
 * window, four fitted critical-power models, a per-kilogram series with the
 * weight behind it and a map of every source activity, and the parser typed
 * three of them, so a cyclist had a list of watts where a runner had a model.
 *
 * Expected behaviour: the parsed curve carries what the body carries, and a
 * body without the extras still parses to a curve rather than to nothing.
 */

import { parsePaceCurveBody, parsePowerCurveBody } from '@/features/stats/lib/curveBodies';
import type { PowerCurve } from '@/types';

/** A body that must parse: the test is about what it carries, not whether it parses. */
function powerCurve(body: unknown, sport = 'Ride'): PowerCurve {
  const curve = parsePowerCurveBody(JSON.stringify(body), sport);
  if (!curve) throw new Error('the body did not parse');
  return curve;
}

/** The shape measured on the live account, 2026-09-05, trimmed to three points. */
const POWER_BODY = {
  list: [
    {
      id: '90d',
      after_kj: 0,
      label: '90 days',
      start_date_local: '2026-06-08T00:00:00',
      end_date_local: '2026-09-06T00:00:00',
      days: 91,
      moving_time: 0,
      training_load: 0,
      weight: 78.949,
      secs: [1, 2, 5],
      values: [568, 547, 500],
      activity_id: ['i1', 'i1', 'i2'],
      watts_per_kg: [7.194518, 6.9285235, 6.33],
      wkg_activity_id: ['i1', 'i1', 'i2'],
      powerModels: [
        { type: 'MS_2P', criticalPower: 119, wPrime: 12799, inputPointIndexes: [83, 99], ftp: 119 },
        {
          type: 'MORTON_3P',
          criticalPower: 110,
          wPrime: 19655,
          pMax: 568,
          inputPointIndexes: [1, 83, 99],
          ftp: 110,
        },
        {
          type: 'FFT_CURVES',
          criticalPower: 137,
          wPrime: 9720,
          pMax: 568,
          inputPointIndexes: [83, 99],
          ftp: 139,
        },
        {
          type: 'ECP',
          criticalPower: 137,
          wPrime: 10440,
          pMax: 568,
          inputPointIndexes: [83, 99],
          ftp: 137,
        },
      ],
      ranks: {},
      mapPlot: { startIndex: 71, poR2: 0.82 },
      watts: [568, 547, 500],
      vo2max_5m: 35.250267,
      compound_score_5m: 349.03546,
    },
  ],
  activities: {
    i1: {
      id: 'i1',
      name: 'Thun Road Cycling',
      distance: 37353.97,
      moving_time: 6950,
      training_load: 103,
      icu_weight: 78.949,
      start_date_local: '2026-08-30T12:05:06',
      race: false,
    },
    i2: {
      id: 'i2',
      name: 'Hill repeats',
      distance: 12000,
      moving_time: 2400,
      training_load: 60,
      icu_weight: 79.1,
      start_date_local: '2026-07-02T07:00:00',
      race: true,
    },
  },
};

describe('the power curve body', () => {
  const curve = powerCurve(POWER_BODY);

  it('still reads the watts the chart draws', () => {
    expect(curve.secs).toEqual([1, 2, 5]);
    expect(curve.watts).toEqual([568, 547, 500]);
    expect(curve.activity_ids).toEqual(['i1', 'i1', 'i2']);
  });

  it('carries the four fitted models the server sends', () => {
    expect(curve.models?.map((m) => m.type)).toEqual(['MS_2P', 'MORTON_3P', 'FFT_CURVES', 'ECP']);
    expect(curve.models?.[0]).toEqual({
      type: 'MS_2P',
      criticalPower: 119,
      wPrime: 12799,
      ftp: 119,
    });
    expect(curve.models?.[1].pMax).toBe(568);
  });

  it('carries watts per kilogram, its activity ids and the weight divided by', () => {
    expect(curve.watts_per_kg).toEqual([7.194518, 6.9285235, 6.33]);
    expect(curve.wkg_activity_ids).toEqual(['i1', 'i1', 'i2']);
    expect(curve.weight).toBe(78.949);
  });

  it('carries every source activity with its date, so a checkpoint has one offline', () => {
    expect(Object.keys(curve.activities ?? {})).toEqual(['i1', 'i2']);
    expect(curve.activities?.i2).toEqual({
      id: 'i2',
      name: 'Hill repeats',
      distance: 12000,
      movingTime: 2400,
      trainingLoad: 60,
      weight: 79.1,
      startDateLocal: '2026-07-02T07:00:00',
      race: true,
    });
  });

  it('carries the window', () => {
    expect(curve.startDate).toBe('2026-06-08T00:00:00');
    expect(curve.endDate).toBe('2026-09-06T00:00:00');
    expect(curve.days).toBe(91);
  });

  it('parses a body with none of the extras to a curve with none, not to nothing', () => {
    const bare = powerCurve({ list: [{ secs: [1], values: [500] }] });
    expect(bare.watts).toEqual([500]);
    expect(bare.models).toBeUndefined();
    expect(bare.watts_per_kg).toBeUndefined();
    expect(bare.weight).toBeUndefined();
    expect(bare.activities).toBeUndefined();
  });

  it('drops a model the server left without a critical power', () => {
    const body = {
      list: [
        {
          secs: [1],
          values: [1],
          powerModels: [
            { type: 'ECP' },
            { type: 'MS_2P', criticalPower: 200, wPrime: 9000, ftp: 200 },
          ],
        },
      ],
    };
    expect(parsePowerCurveBody(JSON.stringify(body), 'Ride')?.models?.map((m) => m.type)).toEqual([
      'MS_2P',
    ]);
  });

  it('reads an empty list as an empty curve', () => {
    const empty = powerCurve({ list: [] });
    expect(empty.secs).toEqual([]);
    expect(empty.models).toBeUndefined();
  });
});

describe('the pace curve body', () => {
  it('carries the source activities the same way', () => {
    const body = {
      list: [
        {
          distance: [100],
          values: [20],
          activity_id: ['i3'],
          paceModels: [{ type: 'CS', criticalSpeed: 3.1, dPrime: 150, r2: 0.99 }],
        },
      ],
      activities: {
        i3: {
          id: 'i3',
          name: 'Tempo',
          distance: 8000,
          moving_time: 2000,
          training_load: 50,
          icu_weight: 78,
          start_date_local: '2026-06-13T07:40:43',
          race: false,
        },
      },
    };
    const curve = parsePaceCurveBody(JSON.stringify(body), 'Run');
    expect(curve?.criticalSpeed).toBe(3.1);
    expect(curve?.activities?.i3.startDateLocal).toBe('2026-06-13T07:40:43');
  });
});
