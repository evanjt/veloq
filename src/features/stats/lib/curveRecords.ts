/**
 * The engine's curve records in the shapes the charts read.
 *
 * The bodies used to be parsed here, once per stats mount and once per sync
 * completion, on the thread drawing the frame. The engine owns
 * the body and now parses it, so what is left is naming: the charts read
 * `watts_per_kg` and a model's `type`, and the record calls them `wattsPerKg`
 * and `kind`.
 */

import type { PaceCurveRow, PowerCurveRow } from 'veloqrs';

import type { PaceCurve, PowerCurve } from '@/types';

export function powerCurveOf(row: PowerCurveRow): PowerCurve {
  return {
    type: 'power',
    sport: row.sport,
    secs: row.secs,
    watts: row.watts,
    watts_per_kg: row.wattsPerKg,
    activity_ids: row.activityIds,
    wkg_activity_ids: row.wkgActivityIds,
    weight: row.weight,
    models: row.models.map((m) => ({
      type: m.kind,
      criticalPower: m.criticalPower,
      wPrime: m.wPrime,
      ftp: m.ftp,
      ...(m.pMax === undefined ? {} : { pMax: m.pMax }),
    })),
    activities: row.activities,
    startDate: row.startDate,
    endDate: row.endDate,
    days: row.days,
  };
}

export function paceCurveOf(row: PaceCurveRow): PaceCurve {
  return {
    type: 'pace',
    sport: row.sport,
    distances: row.distances,
    times: row.times,
    pace: row.pace,
    activity_ids: row.activityIds,
    activities: row.activities,
    criticalSpeed: row.criticalSpeed,
    dPrime: row.dPrime,
    r2: row.r2,
    startDate: row.startDate,
    endDate: row.endDate,
    days: row.days,
  };
}
