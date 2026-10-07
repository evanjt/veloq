import type { FtpTrend } from 'veloqrs';

/** One daily eFTP estimate, keyed by the local day it was stored for. */
export interface FtpSeriesPoint {
  date: string;
  eftp: number;
}

export interface FtpTrendView {
  series: FtpSeriesPoint[];
  latest: number;
  /** The earlier estimate the step was measured from, absent with nothing to compare against. */
  previous: number | undefined;
  /** The engine's step in watts, with its sign. Zero with nothing to compare against. */
  change: number;
  /** The step as a percentage of the earlier estimate it was measured from. */
  changePercent: number;
}

/**
 * The engine's FTP trend as the eFTP chart draws it.
 *
 * The step is the engine's `deltaWatts`; this only dates the points by the day they were stored for and
 * states the step against the earlier estimate.
 */
export function ftpTrendView(trend: FtpTrend): FtpTrendView {
  const change = trend.deltaWatts ?? 0;
  const previous = trend.previousFtp ?? 0;
  return {
    series: trend.history.map((point) => ({
      // The engine dates a day at its midnight UTC, so the UTC day is the stored one.
      date: new Date(Number(point.date) * 1000).toISOString().slice(0, 10),
      eftp: point.value,
    })),
    latest: trend.latestFtp ?? 0,
    previous: trend.previousFtp,
    change,
    changePercent: previous > 0 ? (change / previous) * 100 : 0,
  };
}
