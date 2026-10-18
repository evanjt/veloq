import { useCallback, useMemo, useState } from 'react';
import { RangeCoverage, type FitnessScreenData } from 'veloqrs';

import type { DecouplingSource } from '@/features/activity';
import type { DayActivity } from '@/features/activity/light';
import {
  NO_TRAINING_CARDS,
  trainingCardsView,
  trainingEngineWindows,
  trainingWindows,
  type TrainingCardsRead,
} from '@/features/stats/light';
import { PERIOD_DAYS, SPAN_PERIODS } from '@/shared/app/period';
import { epochDayKeyUtc, formatLocalDate, parseDayString } from '@/shared/format/format';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { EftpChange } from '../lib/eftpChanges';
import { ftpTrendView, type FtpTrendView } from '../lib/ftpTrendView';

/** The parts of the fitness screen read the screen paints itself. */
interface FitnessParts {
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

/** What the fitness tab paints with that stays fixed while it is mounted. */
export interface FitnessScreenRead extends FitnessParts {
  /** The calendar's, the weekly card's and the year comparison's part, handed to each. */
  training: TrainingCardsRead;
}

/** Every span the range picker offers, so a tap between them reads nothing. */
const SPAN_DAYS = SPAN_PERIODS.map((period) => PERIOD_DAYS[period]);

const NO_FITNESS_PARTS: FitnessParts = {
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

function fitnessPartsView(read: FitnessScreenData): FitnessParts {
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
 * LTHR, for every span of the range picker the decoupling ride and the
 * activities the strip under the plot marks, and over the calendar windows
 * the heatmap days, the monthly rows, the year and month to date and the
 * weekly card's every range.
 *
 * The screen reads it once and hands each card its part, so the tab costs one
 * engine call on mount and one per `activities` event, the event the read
 * names as what makes it stale. The sport is chosen with a tap, so the reads
 * over it stay their own, and the range and the weekly card's range pick from
 * what this read holds.
 *
 * A read that throws paints the screen's own parts empty, and hands the
 * calendar cards the error, so they say the read failed rather than draw a
 * year of nothing.
 */
export function useFitnessScreenRead(): FitnessScreenRead {
  // The trend and the calendar windows are measured back from today, so a new
  // day is a new read.
  const day = formatLocalDate(new Date());
  const windows = useMemo(() => trainingWindows(parseDayString(day)), [day]);
  // A retry or a pull to refresh reads again though no event announced a change.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const readActivities = useEngineRead(['activities'], [day, attempt]);

  return useMemo(() => {
    let read: FitnessScreenData | undefined;
    let error: unknown = null;
    try {
      read = readActivities((engine) =>
        engine.getFitnessScreenData(SPAN_DAYS, trainingEngineWindows(windows, new Date()))
      );
    } catch (err) {
      error = err;
    }
    return {
      // A thrown read leaves these empty: the chart reads that as not
      // downloaded and the badge as no estimate yet, the markers are an
      // overlay the plot draws without, and the stored speeds are a fallback
      // the screen has no failure row for.
      ...(read ? fitnessPartsView(read) : NO_FITNESS_PARTS),
      training: {
        windows,
        data: read ? trainingCardsView(read) : NO_TRAINING_CARDS,
        isPending: read === undefined && error === null,
        error,
        retry,
      },
    };
  }, [readActivities, windows, retry]);
}
