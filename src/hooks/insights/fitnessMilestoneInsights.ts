import { formatPaceCompact, formatSwimPace } from '@/lib';
import type { Insight, FtpTrend, PaceTrend, TFunc } from './types';
import { makeInsight } from './insightBuilder';

const MIN_FTP_CHANGE_WATTS = 5;

function toSecondsPerDistanceMeters(speedMetersPerSecond: number, distanceMeters: number): number {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) return 0;
  return distanceMeters / speedMetersPerSecond;
}

function addPaceMilestoneInsight(
  insights: Insight[],
  pace: PaceTrend | null | undefined,
  now: number,
  t: TFunc,
  options: {
    id: string;
    icon: string;
    iconColor: string;
    paceUnit: string;
    changeUnit: string;
    formatValue: (speedMetersPerSecond: number) => string;
  }
): void {
  if (
    !pace ||
    typeof pace.latestPace !== 'number' ||
    typeof pace.previousPace !== 'number' ||
    pace.latestPace <= 0 ||
    pace.previousPace <= 0 ||
    pace.latestPace <= pace.previousPace
  ) {
    return;
  }

  const distanceMeters = options.paceUnit === '/100m' ? 100 : 1000;
  const currentDisplaySecs = toSecondsPerDistanceMeters(pace.latestPace, distanceMeters);
  const previousDisplaySecs = toSecondsPerDistanceMeters(pace.previousPace, distanceMeters);
  const deltaSecs = Math.round(previousDisplaySecs - currentDisplaySecs);
  const gainPercent = Math.round(((pace.latestPace - pace.previousPace) / pace.previousPace) * 100);

  if (deltaSecs <= 0 || gainPercent <= 0) return;

  insights.push(
    makeInsight({
      id: options.id,
      category: 'fitness_milestone',
      priority: 2,
      icon: options.icon as Insight['icon'],
      iconColor: options.iconColor,
      title: t('insights.paceImproved', {
        delta: `${deltaSecs}${options.changeUnit}`,
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.currentPace'),
            value: options.formatValue(pace.latestPace),
            unit: options.paceUnit,
            context: 'good',
          },
          {
            label: t('insights.data.previousPace'),
            value: options.formatValue(pace.previousPace),
            unit: options.paceUnit,
          },
          {
            label: t('insights.data.improvement'),
            value: `+${gainPercent}%`,
            context: 'good',
          },
        ],
      },
      methodology: {
        name: t('insights.methodology.thresholdSpeedName'),
        description: t('insights.methodology.thresholdSpeedDescription'),
      },
    })
  );
}

export function generateFitnessMilestoneInsights(
  ftpTrend: FtpTrend | null,
  paceTrend: PaceTrend | null | undefined,
  swimPaceTrend: PaceTrend | null | undefined,
  now: number,
  t: TFunc
): Insight[] {
  const insights: Insight[] = [];

  // FTP increase
  const ftp = ftpTrend;
  if (
    ftp &&
    typeof ftp.latestFtp === 'number' &&
    typeof ftp.previousFtp === 'number' &&
    ftp.latestFtp > 0 &&
    ftp.previousFtp > 0 &&
    ftp.latestFtp > ftp.previousFtp
  ) {
    const delta = Math.round(ftp.latestFtp - ftp.previousFtp);
    if (delta >= MIN_FTP_CHANGE_WATTS) {
      insights.push(
        makeInsight({
          id: 'fitness_milestone-ftp',
          category: 'fitness_milestone',
          priority: 2,
          icon: 'lightning-bolt',
          iconColor: '#FFA726',
          title: t('insights.ftpIncrease', {
            current: Math.round(ftp.latestFtp),
            change: delta,
          }),
          navigationTarget: '/fitness',
          timestamp: now,
          supportingData: {
            dataPoints: [
              {
                label: t('insights.data.currentFtp'),
                value: Math.round(ftp.latestFtp),
                unit: 'W',
                context: 'good',
              },
              {
                label: t('insights.data.previousFtp'),
                value: Math.round(ftp.previousFtp),
                unit: 'W',
              },
              {
                label: t('insights.data.change'),
                value: `+${delta}`,
                unit: 'W',
                context: 'good',
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
    iconColor: '#66BB6A',
    paceUnit: '/km',
    changeUnit: 's/km',
    formatValue: (speedMetersPerSecond) => formatPaceCompact(speedMetersPerSecond),
  });

  addPaceMilestoneInsight(insights, swimPaceTrend ?? null, now, t, {
    id: 'fitness_milestone-swim-pace',
    icon: 'swim',
    iconColor: '#42A5F5',
    paceUnit: '/100m',
    changeUnit: 's/100m',
    formatValue: (speedMetersPerSecond) => formatSwimPace(speedMetersPerSecond),
  });

  return insights;
}
