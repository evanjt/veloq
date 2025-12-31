import type { WellnessData } from '@/types';

/**
 * Generate demo wellness data for the past year
 * This provides enough data for trends and season comparison
 */
function generateDemoWellness(): WellnessData[] {
  const wellness: WellnessData[] = [];
  const now = new Date();

  // Base values with realistic progression
  let ctl = 35;
  let atl = 35;
  const baseWeight = 75;
  const baseRhr = 55;
  const baseHrv = 50;

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);

    // Seasonal target CTL
    const month = date.getMonth();
    const targetCtl = month >= 11 || month <= 1 ? 35 :
                      month >= 2 && month <= 4 ? 45 :
                      month >= 5 && month <= 7 ? 55 : 45;

    // Simulate daily load
    const dayOfWeek = date.getDay();
    const isRest = dayOfWeek === 1 || (dayOfWeek === 4 && Math.random() < 0.5);
    const dailyTss = isRest ? 0 :
                     dayOfWeek === 0 || dayOfWeek === 6 ? 80 + Math.random() * 50 :
                     40 + Math.random() * 40;

    // Update CTL/ATL
    atl = atl + (dailyTss - atl) / 7;
    ctl = ctl + (dailyTss - ctl) / 42;
    ctl += (targetCtl - ctl) * 0.01;

    // Derived metrics
    const fatigueFactor = atl / 50;
    const rhr = Math.round(baseRhr + fatigueFactor * 5 + (Math.random() - 0.5) * 4);
    const hrv = Math.round(baseHrv - fatigueFactor * 5 + (Math.random() - 0.5) * 10);
    const sleepHours = 7 + (isRest ? 0.5 : 0) + (Math.random() - 0.5) * 1.5;
    const sleepScore = Math.round(70 + (sleepHours - 6) * 10 + Math.random() * 10);

    wellness.push({
      id: date.toISOString().split('T')[0],
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
