import type { WellnessData } from '@/types';

// Generate demo wellness data for the last 90 days
function generateDemoWellness(): WellnessData[] {
  const wellness: WellnessData[] = [];
  const now = new Date();

  // Base values with realistic progression
  const baseCtl = 60;
  const baseAtl = 40;
  const baseHrv = 55;
  const baseRhr = 52;
  const baseSleepHours = 7.5;
  const baseSleepScore = 80;

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    // Simulate training block progression
    const weekNum = Math.floor(daysAgo / 7);
    const dayOfWeek = date.getDay();

    // CTL increases gradually over training block
    const ctlTrend = baseCtl + (90 - daysAgo) * 0.1;
    // ATL fluctuates with weekly pattern (higher mid-week)
    const atlVariation = dayOfWeek >= 2 && dayOfWeek <= 4 ? 10 : -5;
    const atl = baseAtl + atlVariation + (Math.random() * 10 - 5);

    // HRV is inversely related to fatigue
    const hrvVariation = atl > 50 ? -5 : 5;
    const hrv = baseHrv + hrvVariation + (Math.random() * 8 - 4);

    // RHR slightly elevated when fatigued
    const rhrVariation = atl > 50 ? 3 : 0;
    const rhr = baseRhr + rhrVariation + Math.floor(Math.random() * 4 - 2);

    // Sleep varies by day
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const sleepHours = baseSleepHours + (isWeekend ? 1 : 0) + (Math.random() - 0.5);
    const sleepScore = baseSleepScore + (isWeekend ? 5 : 0) + Math.floor(Math.random() * 15 - 7);

    wellness.push({
      id: date.toISOString().split('T')[0],
      ctl: Math.round(ctlTrend * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      rampRate: Math.round((ctlTrend - (baseCtl + (90 - daysAgo - 7) * 0.1)) * 10) / 10,
      hrv: Math.round(hrv),
      hrvSDNN: Math.round(hrv * 1.2),
      restingHR: Math.round(rhr),
      sleepSecs: Math.round(sleepHours * 3600),
      sleepScore: Math.min(100, Math.max(50, Math.round(sleepScore))),
      weight: 75 + (Math.random() * 0.6 - 0.3),
      updated: date.toISOString(),
    } as WellnessData);
  }

  return wellness;
}

export const demoWellness = generateDemoWellness();
