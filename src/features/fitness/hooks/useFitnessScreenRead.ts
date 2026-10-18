import { useMemo } from 'react';
import { RangeCoverage, type FitnessScreenData } from 'veloqrs';

import type { DecouplingSource } from '@/features/activity';
import type { DayActivity } from '@/features/activity/light';
import { PERIOD_DAYS, SPAN_PERIODS } from '@/shared/app/period';
import { epochDayKeyUtc, formatLocalDate } from '@/shared/format/format';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { EftpChange } from '../lib/eftpChanges';
import { ftpTrendView, type FtpTrendView } from '../lib/ftpTrendView';

/** What the fitness tab paints with that stays fixed while it is mounted. */
export interface FitnessScreenRead {
  /** The eFTP over the chart's window, undefined while no day carries an estimate. */
  eftpTrend: FtpTrendView | undefined;
  /** Whether the wellness the trend is read from was downloaded for its window. */
  eftpCoverage: RangeCoverage;
  /** The activities that moved the accepted eFTP, oldest first. */
  eftpChanges: EftpChange[];
  /** The last stored critical speeds in m/s, null when none was ever stored. */
  storedRunPace: number | null;
  storedSwimPace: number | null;
  /** The sport the latest activities are mostly in, null for none or a tie. */
  librarySport: string | null;
  /** The fitness and fatigue time constants in days in effect today, null without a read. */
  fitnessDays: number | null;
  fatigueDays: number | null;
  /** The cycling FTP the athlete set, else the newest ride's, in watts. */
  cyclingFtp: number | null;
  /** The running LTHR the athlete set, in bpm. */
  runningLthr: number | null;
  /** The ride the decoupling card names, by the span's length in days. */
  decouplingBySpan: ReadonlyMap<number, DecouplingSource>;
  /** Every activity of the longest span, oldest first, for the strip under the plot. */
  loadDots: DayActivity[];
}

/** Every span the range picker offers, so a tap between them reads nothing. */
const SPAN_DAYS = SPAN_PERIODS.map((period) => PERIOD_DAYS[period]);

const NO_FITNESS_SCREEN: FitnessScreenRead = {
  eftpTrend: undefined,
  eftpCoverage: RangeCoverage.NotFetched,
  eftpChanges: [],
  storedRunPace: null,
  storedSwimPace: null,
  librarySport: null,
  fitnessDays: null,
  fatigueDays: null,
  cyclingFtp: null,
  runningLthr: null,
  decouplingBySpan: new Map(),
  loadDots: [],
};

function fitnessScreenView(read: FitnessScreenData): FitnessScreenRead {
  return {
    eftpTrend: read.ftpTrend.history.length > 0 ? ftpTrendView(read.ftpTrend) : undefined,
    eftpCoverage: read.ftpTrendCoverage,
    eftpChanges: read.ftpTrend.changes.map((change) => ({
      date: epochDayKeyUtc(Number(change.date)),
      eftp: change.eftp,
      delta: change.delta,
      activityId: change.activityId,
      activityName: change.activityName,
    })),
    storedRunPace: read.runPaceTrend.latestPace ?? null,
    storedSwimPace: read.swimPaceTrend.latestPace ?? null,
    librarySport: read.sportMix.dominant ?? null,
    // Zero is the closed handle's stand-in, never a time constant.
    fitnessDays: read.fitnessDays || null,
    fatigueDays: read.fatigueDays || null,
    cyclingFtp: read.cyclingFtpSetting ?? null,
    runningLthr: read.runningLthr ?? null,
    decouplingBySpan: new Map(
      read.decouplingSources.flatMap(({ days, source }) =>
        source
          ? [
              [
                days,
                {
                  activityId: source.activityId,
                  name: source.name,
                  date: source.startDateLocal,
                  decoupling: source.decoupling,
                },
              ] as const,
            ]
          : []
      )
    ),
    loadDots: read.loadDots.map((dot) => ({
      id: dot.activityId,
      name: dot.name,
      type: dot.sportType as DayActivity['type'],
      load: dot.load,
      startDateLocal: dot.startDateLocal,
      movingTime: dot.movingTime,
      distance: dot.distance,
    })),
  };
}

/**
 * The fitness tab's one screen read: the eFTP trend and its markers, the
 * critical speeds the threshold falls back on when no curve is to hand, the
 * sport the primary sport defaults to, the set cycling FTP and running
 * LTHR, and for every span of the range picker the decoupling ride and the
 * activities the strip under the plot marks.
 *
 * The screen reads it once and hands each card its part, so the tab costs one
 * engine call on mount and one per `activities` event, the event the read
 * names as what makes it stale. The sport is chosen with a tap, so the reads
 * over it stay their own, and the range picks from what this read holds.
 */
export function useFitnessScreenRead(): FitnessScreenRead {
  // The trend is measured back from today, so a new day is a new read.
  const day = formatLocalDate(new Date());
  const readActivities = useEngineRead(['activities'], [day]);

  return useMemo(() => {
    try {
      const read = readActivities((engine) => engine.getFitnessScreenData(SPAN_DAYS));
      return read ? fitnessScreenView(read) : NO_FITNESS_SCREEN;
    } catch {
      // empty-on-error: the chart reads a refused read as not downloaded and the badge as "no estimate yet", the markers are an overlay the plot draws without, and the stored speeds are a fallback the screen has no failure row for.
      return NO_FITNESS_SCREEN;
    }
  }, [readActivities]);
}
