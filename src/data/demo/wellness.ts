import type { WellnessData } from '@/types';
import { getDemoReferenceDate, formatDateId, createDateSeededRandom } from './random';

/**
 * Generate demo wellness data for the past year
 * This provides enough data for trends and season comparison
 * Uses deterministic random for reproducible data
 */
function generateDemoWellness(): WellnessData[] {
  const wellness: WellnessData[] = [];
  const referenceDate = getDemoReferenceDate();

  // Base values with realistic progression
  let ctl = 35;
  let atl = 35;
  const baseWeight = 75;
  const baseRhr = 55;
  const baseHrv = 50;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - daysAgo);
    const dateStr = formatDateId(date);

    // Create date-seeded random for this day's wellness
    const wellnessRandom = createDateSeededRandom(dateStr + '-wellness');

    // Seasonal target CTL
    const month = date.getMonth();
    const targetCtl =
      month >= 11 || month <= 1
        ? 35
        : month >= 2 && month <= 4
          ? 45
          : month >= 5 && month <= 7
            ? 55
            : 45;

    // Simulate daily load (deterministic rest days)
    const dayOfWeek = date.getDay();
    const isRest = dayOfWeek === 1 || (dayOfWeek === 4 && wellnessRandom() < 0.5);
    const dailyTss = isRest
      ? 0
      : dayOfWeek === 0 || dayOfWeek === 6
        ? 80 + wellnessRandom() * 50
        : 40 + wellnessRandom() * 40;

    // Update CTL/ATL
    atl = atl + (dailyTss - atl) / 7;
    ctl = ctl + (dailyTss - ctl) / 42;
    ctl += (targetCtl - ctl) * 0.01;

    // Derived metrics (deterministic)
    const fatigueFactor = atl / 50;
    const rhr = Math.round(baseRhr + fatigueFactor * 5 + (wellnessRandom() - 0.5) * 4);
    const hrv = Math.round(baseHrv - fatigueFactor * 5 + (wellnessRandom() - 0.5) * 10);
    const sleepHours = 7 + (isRest ? 0.5 : 0) + (wellnessRandom() - 0.5) * 1.5;
    const sleepScore = Math.round(70 + (sleepHours - 6) * 10 + wellnessRandom() * 10);

    wellness.push({
      id: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      rampRate: Math.round((ctl - (wellness[wellness.length - 1]?.ctl || ctl)) * 100) / 100,
      hrv: Math.max(20, Math.min(100, hrv)),
      hrvSDNN: Math.round(hrv * 1.2),
      restingHR: Math.round(rhr),
      sleepSecs: Math.round(sleepHours * 3600),
      sleepScore: Math.min(100, Math.max(50, sleepScore)),
      weight: Math.round((baseWeight + Math.sin(daysAgo * 0.1) * 1.5) * 10) / 10,
      updated: date.toISOString(),
    } as WellnessData);
  }

  return wellness;
}

export const demoWellness = generateDemoWellness();
