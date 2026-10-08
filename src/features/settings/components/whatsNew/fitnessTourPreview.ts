import { formFromLoads } from '@/shared/math';

/** One day of the demo block, as the Fitness tab's charts read it. */
export interface TourDay {
  x: number;
  fitness: number;
  fatigue: number;
  form: number;
}

/** Training load by weekday, Monday first: two rest days and a long weekend ride. */
const WEEK_LOADS = [0, 70, 45, 90, 0, 150, 80];
/** Eight weeks: a build, a recovery week, a harder build and a taper. */
const WEEK_SCALES = [1, 1.1, 0.7, 1.1, 1.2, 1.3, 1.35, 0.4];
const START_LOAD = 50;
const FITNESS_DAYS = 42;
const FATIGUE_DAYS = 7;

/**
 * The demo block the slide draws: fitness and fatigue as the 42 and 7 day
 * exponentially weighted averages of a fixed load pattern, the model the
 * Fitness tab describes, and form as their difference.
 */
export function tourTrainingBlock(): TourDay[] {
  let fitness = START_LOAD;
  let fatigue = START_LOAD;
  const days: TourDay[] = [];
  WEEK_SCALES.forEach((scale, week) => {
    WEEK_LOADS.forEach((load, weekday) => {
      fitness += (load * scale - fitness) / FITNESS_DAYS;
      fatigue += (load * scale - fatigue) / FATIGUE_DAYS;
      days.push({
        x: week * WEEK_LOADS.length + weekday,
        fitness: Math.round(fitness),
        fatigue: Math.round(fatigue),
        form: formFromLoads(fitness, fatigue),
      });
    });
  });
  return days;
}

/** Best power over each duration, x the log10 of the seconds and y the watts. */
const POWER_BESTS: readonly [seconds: number, watts: number][] = [
  [5, 1050],
  [15, 880],
  [30, 700],
  [60, 520],
  [120, 420],
  [300, 345],
  [600, 310],
  [1200, 285],
  [2400, 262],
  [3600, 248],
];

export function tourPowerCurve(): { x: number; y: number }[] {
  return POWER_BESTS.map(([seconds, watts]) => ({ x: Math.log10(seconds), y: watts }));
}

/** Share of the block's riding time in each power zone, in percent. */
export function tourZoneShares(): { zone: 1 | 2 | 3 | 4 | 5; percent: number }[] {
  return [
    { zone: 1, percent: 24 },
    { zone: 2, percent: 43 },
    { zone: 3, percent: 14 },
    { zone: 4, percent: 12 },
    { zone: 5, percent: 7 },
  ];
}
