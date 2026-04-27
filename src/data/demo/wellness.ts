import type { WellnessData } from '@/types';
import { fixtures } from './fixtures';

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
