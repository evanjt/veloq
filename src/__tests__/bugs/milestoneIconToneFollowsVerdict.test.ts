/**
 * Scenario: a falling eFTP, a falling critical speed or a worsening efficiency
 * trend drew a neutral icon while its sheet drew the verdict's red arrow.
 *
 * Expected behaviour: the icon tone is the rung of the verdict the insight carries.
 */

import type { EfficiencyTrend } from 'veloqrs';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import type { FtpTrend, PaceTrend } from '@/features/insights/types';
import { verdictRung } from '@/shared/format/trend';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

const ftp = (over: Partial<FtpTrend>): FtpTrend => ({
  latestFtp: 150,
  previousFtp: 170,
  deltaWatts: -20,
  latestDate: NOW,
  previousDate: NOW,
  sampleCount: 20,
  ...over,
});

const pace = (over: Partial<PaceTrend>): PaceTrend => ({
  latestPace: 3.0,
  previousPace: 3.5,
  latestPaceMetricText: '5:33',
  latestPaceImperialText: '8:56',
  previousPaceMetricText: '4:46',
  previousPaceImperialText: '7:40',
  gainPercent: -14,
  deltaSeconds: -30,
  latestDate: NOW,
  previousDate: NOW,
  sampleCount: 10,
  ...over,
});

const point = { date: 1, paceSecsPerKm: 240, avgHr: 150, hrPaceRatio: 0.6 };

function efficiency(direction: number): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    sportType: 'Run',
    points: [point, point, point, point],
    trendSlope: direction === 2 ? 0.0004 : -0.0004,
    direction,
    hrChangeBpm: direction === 2 ? 6 : -6,
    effortCount: 8,
  } as EfficiencyTrend;
}

describe('icon tone follows the verdict', () => {
  it.each([
    ['a falling eFTP', () => generateFitnessMilestoneInsights(ftp({}), null, null, NOW, t)],
    [
      'a rising eFTP',
      () =>
        generateFitnessMilestoneInsights(
          ftp({ latestFtp: 190, previousFtp: 170, deltaWatts: 20 }),
          null,
          null,
          NOW,
          t
        ),
    ],
    [
      'a falling critical speed',
      () => generateFitnessMilestoneInsights(null, pace({}), null, NOW, t),
    ],
    ['a worsening efficiency', () => generateEfficiencyTrendInsights([efficiency(2)], NOW, t)],
    ['an improving efficiency', () => generateEfficiencyTrendInsights([efficiency(0)], NOW, t)],
  ])('%s', (_name, build) => {
    const [insight] = build();
    const verdict = insight.supportingData?.trend?.verdict;

    expect(verdict).toBeDefined();
    if (verdict === 'declined') expect(insight.iconTone).toBe(verdictRung(verdict));
    else expect(insight.iconTone).not.toBe('neutral');
  });
});
