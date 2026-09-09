/**
 * Parse the stored intervals.icu curve bodies into the shapes the charts read.
 *
 * The body is what Rust stores, whole, so the transform lives here rather than
 * on the way back from the network. The raw types below are the shape measured
 * on the live account on 2026-09-05, not the subset one chart happened to need.
 */

import type { CurveActivity, PaceCurve, PowerCurve, PowerModel } from '@/types';

interface RawCurveActivity {
  id?: string;
  name?: string;
  distance?: number;
  moving_time?: number;
  training_load?: number;
  icu_weight?: number;
  start_date_local?: string;
  race?: boolean;
}

interface RawPowerModel {
  type?: string;
  criticalPower?: number;
  wPrime?: number;
  ftp?: number;
  pMax?: number;
}

interface RawWindow {
  start_date_local?: string;
  end_date_local?: string;
  days?: number;
  weight?: number;
  activity_id?: string[];
}

interface RawPowerCurve {
  list?: (RawWindow & {
    secs?: number[];
    values?: number[];
    watts_per_kg?: number[];
    wkg_activity_id?: string[];
    powerModels?: RawPowerModel[];
  })[];
  activities?: Record<string, RawCurveActivity>;
}

interface RawPaceCurve {
  list?: (RawWindow & {
    distance?: number[];
    values?: number[];
    paceModels?: {
      type: string;
      criticalSpeed?: number;
      dPrime?: number;
      r2?: number;
    }[];
  })[];
  activities?: Record<string, RawCurveActivity>;
}

function parse<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/** The source activities keyed by id, or nothing when the body names none. */
function activitiesOf(
  raw: Record<string, RawCurveActivity> | undefined
): Record<string, CurveActivity> | undefined {
  if (!raw) return undefined;
  const out: Record<string, CurveActivity> = {};
  for (const [id, a] of Object.entries(raw)) {
    out[id] = {
      id: a.id ?? id,
      name: a.name ?? '',
      distance: a.distance ?? 0,
      movingTime: a.moving_time ?? 0,
      trainingLoad: a.training_load ?? 0,
      weight: a.icu_weight ?? 0,
      startDateLocal: a.start_date_local ?? '',
      race: a.race ?? false,
    };
  }
  return out;
}

/** A model the server finished fitting: one without a critical power is dropped. */
function modelsOf(raw: RawPowerModel[] | undefined): PowerModel[] | undefined {
  if (!raw) return undefined;
  const models: PowerModel[] = [];
  for (const m of raw) {
    if (!m.type || m.criticalPower == null || m.wPrime == null || m.ftp == null) continue;
    const model: PowerModel = {
      type: m.type,
      criticalPower: m.criticalPower,
      wPrime: m.wPrime,
      ftp: m.ftp,
    };
    if (m.pMax != null) model.pMax = m.pMax;
    models.push(model);
  }
  return models;
}

/** `values` is renamed to watts, matching what the power chart expects. */
export function parsePowerCurveBody(body: string, sport: string): PowerCurve | null {
  const parsed = parse<RawPowerCurve>(body);
  if (!parsed) return null;
  const curve = parsed.list?.[0];
  return {
    type: 'power',
    sport,
    secs: curve?.secs || [],
    watts: curve?.values || [],
    watts_per_kg: curve?.watts_per_kg,
    activity_ids: curve?.activity_id,
    wkg_activity_ids: curve?.wkg_activity_id,
    weight: curve?.weight,
    models: modelsOf(curve?.powerModels),
    activities: activitiesOf(parsed.activities),
    startDate: curve?.start_date_local,
    endDate: curve?.end_date_local,
    days: curve?.days,
  };
}

/** Pace is metres per second at each distance, with a divide-by-zero guard. */
export function parsePaceCurveBody(body: string, sport: string): PaceCurve | null {
  const parsed = parse<RawPaceCurve>(body);
  if (!parsed) return null;
  const curve = parsed.list?.[0];
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
    activities: activitiesOf(parsed.activities),
    criticalSpeed: csModel?.criticalSpeed,
    dPrime: csModel?.dPrime,
    r2: csModel?.r2,
    startDate: curve?.start_date_local,
    endDate: curve?.end_date_local,
    days: curve?.days,
  };
}
