import type { WellnessData } from '@/types';
import type { ApiWellness } from '@/features/activity/demo/types';
import { fixtures } from '@/features/activity/demo/activities';

export const demoWellness: WellnessData[] = fixtures.wellness.map((w) => ({
  id: w.id,
  ctl: w.ctl,
  atl: w.atl,
  rampRate: w.rampRate,
  hrv: w.hrv,
  hrvSDNN: w.hrvSDNN,
  restingHR: w.restingHR,
  sleepSecs: w.sleepSecs,
  sleepScore: w.sleepScore,
  weight: w.weight,
  updated: new Date(w.id + 'T00:00:00').toISOString(),
})) as WellnessData[];

export function getWellness(params?: { oldest?: string; newest?: string }): ApiWellness[] {
  let result = [...fixtures.wellness];

  if (params?.oldest) {
    result = result.filter((w) => w.id >= params.oldest!);
  }
  if (params?.newest) {
    result = result.filter((w) => w.id <= params.newest!);
  }

  return result;
}
