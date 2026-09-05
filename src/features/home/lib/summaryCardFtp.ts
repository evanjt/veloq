/**
 * The FTP the summary card shows, and the value its arrow compares against.
 *
 * Both come from the trend, which is the daily model estimate. Taking the
 * number from the athlete's configured setting and the comparison from the
 * trend measured one series against another: on a five-year account the
 * setting held one value throughout while the estimate moved every few days,
 * so the arrow described a change the number never made.
 */

export interface SummaryCardFtpInput {
  trend: { latestFtp?: number | null; previousFtp?: number | null };
  /** The configured setting, kept only for surfaces where a setting is meant. */
  configuredFtp?: number | null;
}

export interface SummaryCardFtp {
  value: number | null;
  previous: number | null;
}

export function summaryCardFtp({ trend }: SummaryCardFtpInput): SummaryCardFtp {
  return {
    value: trend.latestFtp ?? null,
    previous: trend.previousFtp ?? null,
  };
}
