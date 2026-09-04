/**
 * Parse the stored intervals.icu curve bodies into the shapes the charts read.
 *
 * These are the transforms the axios client used to apply on the way back from
 * the API. The body is what Rust stores, so the transform moved here rather
 * than being lost.
 */

import type { PaceCurve, PowerCurve } from '@/types';

interface RawPowerCurve {
  list?: { secs?: number[]; values?: number[]; activity_id?: string[] }[];
}

interface RawPaceCurve {
  list?: {
    distance?: number[];
    values?: number[];
    activity_id?: string[];
    start_date_local?: string;
    end_date_local?: string;
    days?: number;
    paceModels?: {
      type: string;
      criticalSpeed?: number;
      dPrime?: number;
      r2?: number;
    }[];
  }[];
}

/** `values` is renamed to watts, matching what the power chart expects. */
export function parsePowerCurveBody(body: string, sport: string): PowerCurve | null {
  let parsed: RawPowerCurve;
  try {
    parsed = JSON.parse(body) as RawPowerCurve;
  } catch {
    return null;
  }
  const curve = parsed?.list?.[0];
  return {
    type: 'power',
    sport,
    secs: curve?.secs || [],
    watts: curve?.values || [],
    activity_ids: curve?.activity_id,
  };
}

/** Pace is metres per second at each distance, with a divide-by-zero guard. */
export function parsePaceCurveBody(body: string, sport: string): PaceCurve | null {
  let parsed: RawPaceCurve;
  try {
    parsed = JSON.parse(body) as RawPaceCurve;
  } catch {
    return null;
  }
  const curve = parsed?.list?.[0];
  const distances = curve?.distance || [];
  const times = curve?.values || [];

  const pace = distances.map((dist, i) => {
    const time = times[i];
    return time > 0 ? dist / time : 0;
  });

  const csModel = curve?.paceModels?.find((m) => m.type === 'CS');

  return {
    type: 'pace',
    sport,
    distances,
    times,
    pace,
    activity_ids: curve?.activity_id,
    criticalSpeed: csModel?.criticalSpeed,
    dPrime: csModel?.dPrime,
    r2: csModel?.r2,
    startDate: curve?.start_date_local,
    endDate: curve?.end_date_local,
    days: curve?.days,
  };
}
