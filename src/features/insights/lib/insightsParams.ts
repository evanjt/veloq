/**
 * Scalar inputs for the engine's insights bundle.
 *
 * The feed and the routes tab both feed the same pipeline, so both build their
 * parameters here and the windows they ask for stay identical.
 */

import type { InsightsParams } from 'veloqrs';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

import { INSIGHTS_CONFIG, maxPerCategoryFor, minAgeDaysFor } from './config';
import { wellnessWindow } from './wellnessWindow';

/** Ranked sections requested per sport. */
const RANKED_LIMIT = 50;

/** Efficiency candidates taken from each sport's ranked list. */
const EFFICIENCY_PER_SPORT = 5;

/**
 * The trailing window form is read from.
 *
 * Thirty days is what both callers asked for before the engine did the reading:
 * the tab through `useWellness('1m')` and the headless task through its own
 * `getWellnessDays`. Only the newest day in it is the reading, so the window is
 * what decides whether there is one at all.
 */
/**
 * History points a card carries at most, per section and per trend.
 *
 * The graphic is a strip a few dozen pixels wide, so more than this crosses
 * the bridge for pixels nobody can tell apart. The engine caps its own series
 * too, in `persistence/screens.rs` and `sections/ranking.rs`, so a caller
 * asking for more gets what the read holds rather than a library of laps.
 */
const HISTORY_LIMIT = 20;

const WELLNESS_WINDOW_DAYS = 30;

/** The trailing window the HRV verdict is read over. */
const HRV_WINDOW_DAYS = 7;

/** The trailing window the section-change list covers. */
const SECTION_CHANGE_WINDOW_DAYS = 14;

const toTs = (d: Date) => localWallClockToEpochSeconds(d);

/** The four trailing weeks the strength insights compare. */
function trailingStrengthWeeks(): { startTs: number; endTs: number }[] {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: { startTs: number; endTs: number }[] = [];
  for (let index = 3; index >= 0; index -= 1) {
    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() - index * 7);

    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);

    ranges.push({ startTs: toTs(rangeStart), endTs: toTs(rangeEnd) });
  }

  return ranges;
}

/** The trailing 28 days the monthly strength summary covers. */
function trailingStrengthMonth(): { startTs: number; endTs: number } {
  const end = new Date();
  end.setHours(23, 59, 59, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  start.setHours(0, 0, 0, 0);

  return { startTs: toTs(start), endTs: toTs(end) };
}

/**
 * Build the parameters for `getInsightsData` / `getStartupData` from the
 * current clock and the insights configuration.
 */
export function buildInsightsParams(): InsightsParams {
  const now = new Date();

  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  // The four weeks before last week. The engine reads the chronic window as
  // `chronic_start .. prev_start` and divides by a fixed four, so it starts
  // four weeks before the previous week and not before the current one.
  const chronicStart = new Date(startOfLastWeek);
  chronicStart.setDate(chronicStart.getDate() - 28);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const wellness = wellnessWindow(now, WELLNESS_WINDOW_DAYS);

  return {
    historyLimit: HISTORY_LIMIT,
    currentStart: toTs(startOfWeek),
    currentEnd: toTs(now),
    prevStart: toTs(startOfLastWeek),
    prevEnd: toTs(startOfWeek) - 1,
    chronicStart: toTs(chronicStart),
    todayStart: toTs(todayStart),
    includeSections: isRouteMatchingEnabled(),
    rankedLimit: RANKED_LIMIT,
    activeWindowDays: INSIGHTS_CONFIG.activeWindowDays,
    efficiencyPerSport: EFFICIENCY_PER_SPORT,
    efficiencyLimit: maxPerCategoryFor('efficiency_trend'),
    efficiencyMinEfforts: INSIGHTS_CONFIG.repetition.efficiency_trend_min,
    strengthMonth: trailingStrengthMonth(),
    strengthWeeks: trailingStrengthWeeks(),
    wellnessOldest: wellness.oldest,
    wellnessNewest: wellness.newest,
    hrvWindowDays: HRV_WINDOW_DAYS,
    sectionChangeWindowDays: SECTION_CHANGE_WINDOW_DAYS,
    staleThresholdDays: minAgeDaysFor('stale_pr'),
    staleMinGainPercent: INSIGHTS_CONFIG.thresholds.minFtpGainPercent,
    staleMaxOpportunities: maxPerCategoryFor('stale_pr'),
  };
}
