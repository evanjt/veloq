import {
  formatPaceCompact,
  formatSwimPace,
  paceSecondsForUnit,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import type { Insight, FtpTrend, PaceTrend, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { INSIGHTS_CONFIG, confidenceFrom } from '../lib/config';
import type { InsightTone } from '@/theme';
import { fitnessTarget } from '@/shared/app/fitnessEntry';
import { sparkline } from '../lib/sparkline';

const YEAR_2000_MS = 946_684_800_000;

/**
 * The day a snapshot is dated, as the fitness chart selects days.
 *
 * `latest_date` is a `YYYY-MM-DD` parsed at UTC midnight
 * (`epoch_seconds` in `persistence/fitness/derivations.rs`), so reading it back in UTC
 * returns the day it was written as.
 */
function dayOf(d: bigint | number | undefined): string | null {
  const ms = dateToMs(d);
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10);
}

function dateToMs(d: bigint | number | undefined): number | undefined {
  if (d == null) return undefined;
  const n = typeof d === 'bigint' ? Number(d) : d;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Heuristic: values under 1e12 look like seconds, otherwise ms.
  const ms = n < 1e12 ? n * 1000 : n;
  // Reject implausibly old dates (test placeholders, corrupt data) - real
  // activity dates are post-2000. Without this, a BigInt(1000) in a test
  // becomes 1970-01-01 and fails the recency gate.
  if (ms < YEAR_2000_MS) return undefined;
  return ms;
}

function addPaceMilestoneInsight(
  insights: Insight[],
  pace: PaceTrend | null | undefined,
  now: number,
  t: TFunc,
  options: {
    id: string;
    icon: string;
    iconTone: InsightTone;
    paceUnit: string;
    sport: 'run' | 'swim';
    isMetric: boolean;
    formatValue: (speedMetersPerSecond: number) => string;
  }
): void {
  if (
    !pace ||
    typeof pace.latestPace !== 'number' ||
    typeof pace.previousPace !== 'number' ||
    typeof pace.gainPercent !== 'number' ||
    typeof pace.deltaSeconds !== 'number' ||
    pace.latestPace <= 0 ||
    pace.previousPace <= 0 ||
    pace.latestPace === pace.previousPace
  ) {
    return;
  }

  // The engine measured the move per kilometre or per 100 m, so both numbers
  // are read rather than derived: only the unit and the rounding are ours.
  const deltaSecs = Math.round(
    paceSecondsForUnit(pace.deltaSeconds, options.sport, options.isMetric)
  );
  const gainPercent = Math.round(pace.gainPercent);
  const declining = pace.latestPace < pace.previousPace;
  const minPercent = declining
    ? INSIGHTS_CONFIG.thresholds.minPaceDeclinePercent
    : INSIGHTS_CONFIG.thresholds.minPaceChangePercent;

  if (
    Math.sign(pace.gainPercent) !== (declining ? -1 : 1) ||
    Math.sign(pace.deltaSeconds) !== (declining ? -1 : 1) ||
    Math.abs(pace.gainPercent) < minPercent ||
    deltaSecs === 0 ||
    gainPercent === 0
  )
    return;

  insights.push(
    makeInsight({
      id: options.id,
      category: 'fitness_milestone',
      priority: 2,
      icon: options.icon as Insight['icon'],
      iconTone: declining ? 'neutral' : options.iconTone,
      title: t(declining ? 'insights.paceChange' : 'insights.paceImproved', {
        delta: `${declining ? '−' : ''}${Math.abs(deltaSecs)}s${options.paceUnit}`,
      }),
      navigationTarget: fitnessTarget({ date: dayOf(pace.latestDate) }),
      timestamp: now,
      // The snapshots the pace history was read from. A step measured off
      // three is a thinner claim than the same step off twenty.
      confidence: confidenceFrom('fitness_milestone', pace.sampleCount ?? 0),
      meta: {
        sourceTimestamp: dateToMs(pace.latestDate) ?? now,
        comparisonKind: 'self',
      },
      supportingData: {
        ...sparkline(pace.history, t('insights.data.paceHistory')),
        trend: {
          direction: declining ? 'down' : 'up',
          verdict: declining ? 'declined' : 'improved',
        },
        dataPoints: [
          {
            label: t('insights.data.currentPace'),
            value: options.formatValue(pace.latestPace),
            unit: options.paceUnit,
            context: declining ? 'neutral' : 'good',
          },
          {
            label: t('insights.data.previousPace'),
            value: options.formatValue(pace.previousPace),
            unit: options.paceUnit,
          },
          {
            label: t('insights.data.improvement'),
            value: `${declining ? '' : '+'}${gainPercent}%`,
            context: declining ? 'neutral' : 'good',
          },
        ],
      },
      methodology: {
        name: t('insights.methodology.criticalSpeedName'),
        description: t('insights.methodology.criticalSpeedDescription'),
      },
    })
  );
}

export function generateFitnessMilestoneInsights(
  ftpTrend: FtpTrend | null,
  paceTrend: PaceTrend | null | undefined,
  swimPaceTrend: PaceTrend | null | undefined,
  now: number,
  t: TFunc,
  isMetric = true
): Insight[] {
  const insights: Insight[] = [];

  // FTP increase
  const ftp = ftpTrend;
  if (
    ftp &&
    typeof ftp.latestFtp === 'number' &&
    typeof ftp.previousFtp === 'number' &&
    typeof ftp.deltaWatts === 'number' &&
    ftp.latestFtp > 0 &&
    ftp.previousFtp > 0 &&
    ftp.latestFtp !== ftp.previousFtp
  ) {
    const delta = ftp.deltaWatts;
    const declining = ftp.latestFtp < ftp.previousFtp;
    const minChange = declining
      ? INSIGHTS_CONFIG.thresholds.minFtpDeclineWatts
      : INSIGHTS_CONFIG.thresholds.minFtpChangeWatts;
    if (Math.sign(delta) === (declining ? -1 : 1) && Math.abs(delta) >= minChange) {
      insights.push(
        makeInsight({
          id: 'fitness_milestone-ftp',
          category: 'fitness_milestone',
          priority: 2,
          icon: 'lightning-bolt',
          iconTone: declining ? 'neutral' : 'positive',
          title: t(declining ? 'insights.ftpChange' : 'insights.ftpIncrease', {
            current: Math.round(ftp.latestFtp),
            change: declining ? `−${Math.abs(delta)}` : delta,
          }),
          navigationTarget: fitnessTarget({ date: dayOf(ftp.latestDate) }),
          timestamp: now,
          confidence: confidenceFrom('fitness_milestone', ftp.sampleCount ?? 0),
          meta: {
            sourceTimestamp: dateToMs(ftp.latestDate) ?? now,
            comparisonKind: 'self',
          },
          supportingData: {
            ...sparkline(ftp.history, t('insights.data.ftpHistory')),
            trend: {
              direction: declining ? 'down' : 'up',
              verdict: declining ? 'declined' : 'improved',
            },
            dataPoints: [
              {
                label: t('insights.data.currentFtp'),
                value: Math.round(ftp.latestFtp),
                unit: 'W',
                context: declining ? 'neutral' : 'good',
              },
              {
                label: t('insights.data.previousFtp'),
                value: Math.round(ftp.previousFtp),
                unit: 'W',
              },
              {
                label: t('insights.data.change'),
                value: `${declining ? '' : '+'}${delta}`,
                unit: 'W',
                context: declining ? 'neutral' : 'good',
              },
            ],
          },
          methodology: {
            name: t('insights.methodology.ftpEstimationName'),
            description: t('insights.methodology.ftpEstimation'),
          },
        })
      );
    }
  }

  addPaceMilestoneInsight(insights, paceTrend ?? null, now, t, {
    id: 'fitness_milestone-pace',
    icon: 'run-fast',
    iconTone: 'positive',
    paceUnit: paceUnitLabel(isMetric),
    sport: 'run',
    isMetric,
    formatValue: (speedMetersPerSecond) => formatPaceCompact(speedMetersPerSecond, isMetric),
  });

  addPaceMilestoneInsight(insights, swimPaceTrend ?? null, now, t, {
    id: 'fitness_milestone-swim-pace',
    icon: 'swim',
    iconTone: 'info',
    paceUnit: swimPaceUnitLabel(isMetric),
    sport: 'swim',
    isMetric,
    formatValue: (speedMetersPerSecond) => formatSwimPace(speedMetersPerSecond, isMetric),
  });

  return insights;
}
