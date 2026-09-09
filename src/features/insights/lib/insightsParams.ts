/**
 * Scalar inputs for the engine's insights bundle.
 *
 * The feed and the routes tab both feed the same pipeline, so both build their
 * parameters here and the windows they ask for stay identical.
 */

import type { InsightsParams } from 'veloqrs';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

import { INSIGHTS_CONFIG, maxPerCategoryFor } from './config';

/** Ranked sections requested per sport. */
const RANKED_LIMIT = 50;

/** Efficiency candidates taken from each sport's ranked list. */
const EFFICIENCY_PER_SPORT = 5;

const toTs = (d: Date) => BigInt(localWallClockToEpochSeconds(d));

/** The four trailing weeks the strength insights compare. */
function trailingStrengthWeeks(): { startTs: bigint; endTs: bigint }[] {
  const end = new Date();
  end.setHours(23, 59, 59, 0);

  const ranges: { startTs: bigint; endTs: bigint }[] = [];
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
function trailingStrengthMonth(): { startTs: bigint; endTs: bigint } {
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

  const fourWeeksAgo = new Date(startOfWeek);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  return {
    currentStart: toTs(startOfWeek),
    currentEnd: toTs(now),
    prevStart: toTs(startOfLastWeek),
    prevEnd: toTs(startOfWeek) - 1n,
    chronicStart: toTs(fourWeeksAgo),
    todayStart: toTs(todayStart),
    includeSections: isRouteMatchingEnabled(),
    rankedLimit: RANKED_LIMIT,
    activeWindowDays: INSIGHTS_CONFIG.activeWindowDays,
    efficiencyPerSport: EFFICIENCY_PER_SPORT,
    efficiencyLimit: maxPerCategoryFor('efficiency_trend'),
    efficiencyMinEfforts: INSIGHTS_CONFIG.repetition.efficiency_trend_min,
    strengthMonth: trailingStrengthMonth(),
    strengthWeeks: trailingStrengthWeeks(),
  };
}
