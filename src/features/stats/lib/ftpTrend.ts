/** One eFTP sample: the date it was set on and the watts. */
export interface FtpSample {
  date: string;
  eftp: number;
}

export interface FtpChange {
  baseline: number;
  latest: number;
  change: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The change in eFTP over the last `days`, against the newest sample dated at
 * or before the cutoff.
 *
 * eFTP lands per test rather than per month, so a fixed count back reads
 * whatever interval the athlete happens to test at: four samples back is three
 * weeks for a weekly tester, and the card underneath says "from 3 months ago".
 * Samples older than the whole history fall back to the oldest one there is,
 * which is the honest answer for an athlete who started inside the window.
 */
export function ftpChangeOverDays(samples: FtpSample[], days: number): FtpChange {
  const dated = samples
    .map((sample) => ({ eftp: sample.eftp, at: Date.parse(sample.date) }))
    .filter((sample) => Number.isFinite(sample.at))
    .sort((a, b) => a.at - b.at);

  if (dated.length === 0) return { baseline: 0, latest: 0, change: 0 };

  const latest = dated[dated.length - 1];
  const cutoff = latest.at - days * MS_PER_DAY;

  const atOrBefore = dated.filter((sample) => sample.at <= cutoff);
  const baseline = atOrBefore.length > 0 ? atOrBefore[atOrBefore.length - 1] : dated[0];

  return {
    baseline: baseline.eftp,
    latest: latest.eftp,
    change: latest.eftp - baseline.eftp,
  };
}
