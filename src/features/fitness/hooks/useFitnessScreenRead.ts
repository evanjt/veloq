import { useMemo } from 'react';
import type { FitnessScreenData } from 'veloqrs';

import { epochDayKeyUtc, formatLocalDate } from '@/shared/format/format';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { EftpChange } from '../lib/eftpChanges';
import { ftpTrendView, type FtpTrendView } from '../lib/ftpTrendView';

/** What the fitness tab paints with that stays fixed while it is mounted. */
export interface FitnessScreenRead {
  /** The eFTP over the chart's window, undefined while no day carries an estimate. */
  eftpTrend: FtpTrendView | undefined;
  /** The activities that moved the accepted eFTP, oldest first. */
  eftpChanges: EftpChange[];
  /** The last stored critical speeds in m/s, null when none was ever stored. */
  storedRunPace: number | null;
  storedSwimPace: number | null;
}

const NO_FITNESS_SCREEN: FitnessScreenRead = {
  eftpTrend: undefined,
  eftpChanges: [],
  storedRunPace: null,
  storedSwimPace: null,
};

function fitnessScreenView(read: FitnessScreenData): FitnessScreenRead {
  return {
    eftpTrend: read.ftpTrend.history.length > 0 ? ftpTrendView(read.ftpTrend) : undefined,
    eftpChanges: read.ftpTrend.changes.map((change) => ({
      date: epochDayKeyUtc(Number(change.date)),
      eftp: change.eftp,
      delta: change.delta,
      activityId: change.activityId,
      activityName: change.activityName,
    })),
    storedRunPace: read.runPaceTrend.latestPace ?? null,
    storedSwimPace: read.swimPaceTrend.latestPace ?? null,
  };
}

/**
 * The fitness tab's one screen read: the eFTP trend and its markers, and the
 * critical speeds the threshold falls back on when no curve is to hand.
 *
 * The screen reads it once and hands each card its part, so the tab costs one
 * engine call on mount and one per `activities` event, the event the read
 * names as what makes it stale. The range and sport are chosen with a tap, so
 * the reads over them stay their own.
 */
export function useFitnessScreenRead(): FitnessScreenRead {
  // The trend is measured back from today, so a new day is a new read.
  const day = formatLocalDate(new Date());
  const readActivities = useEngineRead(['activities'], [day]);

  return useMemo(() => {
    try {
      const read = readActivities((engine) => engine.getFitnessScreenData());
      return read ? fitnessScreenView(read) : NO_FITNESS_SCREEN;
    } catch {
      // empty-on-error: the chart and badge read empty as "no estimate yet", the markers are an overlay the plot draws without, and the stored speeds are a fallback the screen has no failure row for.
      return NO_FITNESS_SCREEN;
    }
  }, [readActivities]);
}
