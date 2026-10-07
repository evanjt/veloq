/**
 * Scalar inputs for the engine's insights bundle.
 *
 * The feed and the routes tab both feed the same pipeline, so both build their
 * parameters here and the windows they ask for stay identical.
 */

import type { InsightsParams } from 'veloqrs';
import { isRouteMatchingEnabled } from '@/features/routes';
import { currentAndPreviousWeek } from '@/features/fitness';
import { getMonday } from '@/shared/format/format';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { trailingWeekRanges } from '@/shared/time/trailingWeeks';

import { INSIGHTS_CONFIG, maxAgeDaysFor, maxPerCategoryFor, minAgeDaysFor } from './config';
import { wellnessWindow } from './wellnessWindow';

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

const toTs = (d: Date) => localWallClockToEpochSeconds(d);

/** How many trailing weeks the strength insights compare. */
const STRENGTH_WEEKS = 4;

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

  const { weekStartTs, prevStartTs } = currentAndPreviousWeek(now);

  // Last week up to the same weekday and time as now, so a part-week is
  // compared with the same part of the previous one.
  const samePointLastWeek = new Date(now);
  samePointLastWeek.setDate(samePointLastWeek.getDate() - 7);

  // The four weeks before last week. The engine reads the chronic window as
  // `chronic_start .. prev_start` and divides by a fixed four, so it starts
  // four weeks before the previous week and not before the current one.
  const chronicStart = getMonday(now);
  chronicStart.setDate(chronicStart.getDate() - 7 - 28);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const wellness = wellnessWindow(now, WELLNESS_WINDOW_DAYS);

  return {
    historyLimit: HISTORY_LIMIT,
    currentStart: weekStartTs,
    currentEnd: toTs(now),
    prevStart: prevStartTs,
    prevEnd: toTs(samePointLastWeek),
    chronicStart: toTs(chronicStart),
    todayStart: toTs(todayStart),
    includeSections: isRouteMatchingEnabled(),
    rankedLimit: INSIGHTS_CONFIG.limits.rankedPerSport,
    activeWindowDays: INSIGHTS_CONFIG.activeWindowDays,
    efficiencyPerSport: INSIGHTS_CONFIG.limits.efficiencyPerSport,
    efficiencyMinHrChangeBpm: INSIGHTS_CONFIG.thresholds.efficiencyMinHrChangeBpm,
    efficiencyLimit: maxPerCategoryFor('efficiency_trend'),
    efficiencyMinEfforts: INSIGHTS_CONFIG.repetition.efficiency_trend_min,
    efficiencyDecliningMinEfforts: INSIGHTS_CONFIG.repetition.efficiency_trend_declining_min,
    strengthMonth: trailingStrengthMonth(),
    strengthWeeks: trailingWeekRanges(STRENGTH_WEEKS),
    wellnessOldest: wellness.oldest,
    wellnessNewest: wellness.newest,
    hrvWindowDays: INSIGHTS_CONFIG.windows.hrvDays,
    sectionChangeWindowDays: maxAgeDaysFor('section_changed'),
    staleThresholdDays: minAgeDaysFor('stale_pr'),
    staleMinGainPercent: INSIGHTS_CONFIG.thresholds.staleMinGainPercent,
    staleMaxOpportunities: INSIGHTS_CONFIG.thresholds.staleMaxOpportunities,
    staleMinTraversals: INSIGHTS_CONFIG.repetition.stale_pr_min_lifetime,
    recentPrWindowDays: maxAgeDaysFor('section_pr'),
    recentPrMinOutings: INSIGHTS_CONFIG.repetition.section_pr_min_outings,
  };
}
