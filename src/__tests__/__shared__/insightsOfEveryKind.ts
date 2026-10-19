/**
 * Insights as their generators write them, one card in every category, for the
 * suites that check something every card must carry.
 */

import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { generateRouteInsights } from '@/features/insights/generators/routeInsights';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { Insight, TFunc } from '@/features/insights/types';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength/types';
import type { EfficiencyTrend, StalePrOpportunity } from 'veloqrs';

export const NOW = 1_700_000_000_000;
export const DAY = 86_400;

export const efforts = (ids: string[]) =>
  ids.map((activityId, index) => ({
    value: 260 - index * 10,
    date: DAY * (index + 1),
    activityId,
  }));

export function summary(
  sets: number,
  activityCount: number,
  balance: StrengthSummary['balance'] = []
): StrengthSummary {
  return {
    muscleVolumes: [
      {
        slug: 'chest',
        primarySets: sets,
        secondarySets: 0,
        weightedSets: sets,
        totalReps: 0,
        volumeKg: 0,
        exerciseNames: [],
        shade: 1,
      },
    ],
    activityCount,
    totalSets: sets,
    maxWeightedSets: sets,
    balance,
  };
}

export const lopsided: StrengthSummary['balance'][number] = {
  id: 'push_pull',
  leftSlug: 'chest',
  rightSlug: 'upper-back',
  leftWeightedSets: 16,
  rightWeightedSets: 4,
  dominantSlug: 'chest',
  ratio: 4,
  status: 'imbalanced',
};

const week = (totalTss: number) => ({ count: 2, totalDuration: 3600, totalDistance: 1, totalTss });

/** The trained muscle, its weekly sets fallen from five to three. */
export const easedOff: StrengthProgressionRecord = {
  muscleSlug: 'chest',
  weeklyWeightedSets: [5, 5, 3, 3],
  recentAverage: 3,
  baselineAverage: 5,
  peakWeightedSets: 5,
  changePct: -40,
  trend: 'down',
  signalDelta: 1.5,
};

/**
 * One card per category, each as its own generator writes it, in the language
 * `t` answers in.
 */
export function oneOfEach(t: TFunc, progressions: StrengthProgressionRecord[] = []): Insight[] {
  const stale = {
    sectionId: 'quarry',
    sectionName: 'Quarry',
    bestTimeSecs: 240,
    daysSinceLast: 60,
    traversalCount: 4,
    fitnessMetric: 'power',
    currentValue: 260,
    previousValue: 240,
    gainPercent: 8,
    unit: 'W',
    sportType: 'Ride',
    bestActivityId: 'quarry-2',
    recentEfforts: efforts(['quarry-1', 'quarry-2', 'quarry-3']),
  } as StalePrOpportunity;
  const efficiency = {
    sectionId: 'orchard',
    sectionName: 'Orchard',
    sportType: 'Ride',
    points: [1, 2, 3, 4].map((day, index) => ({
      date: day * DAY,
      paceSecsPerKm: 240,
      avgHr: 150,
      hrPaceRatio: 36000 - index * 100,
    })),
    trendSlope: -100,
    direction: 0,
    hrChangeBpm: -5,
    effortCount: 4,
  } as EfficiencyTrend;
  const previousDate = 1_700_000_000;
  const weekly = [1000, 2000, 3000, 4000].map((startTs, index) => ({
    ...summary(index + 2, index + 1, [lopsided]),
    startTs,
  }));

  return [
    ...generateSectionPRInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          bestTime: 240,
          daysAgo: 1,
          traversalCount: 4,
          bestActivityId: 'ridge-3',
          recentEfforts: efforts(['ridge-1', 'ridge-2', 'ridge-3']),
        },
      ],
      NOW,
      t
    ),
    ...generateSectionTrendInsights(
      [
        {
          sectionId: 'lowland',
          sectionName: 'Lowland',
          trend: 1,
          medianRecentSecs: 420,
          bestTimeSecs: 400,
          traversalCount: 6,
          sportType: 'Ride',
          ranking: { relevance: 0.4, recency: 0, improvement: 0, anomaly: 0, engagement: 0 },
        },
        {
          sectionId: 'causeway',
          sectionName: 'Causeway',
          trend: -1,
          medianRecentSecs: 320,
          bestTimeSecs: 300,
          traversalCount: 8,
          sportType: 'Ride',
          ranking: { relevance: 0.9, recency: 0, improvement: 0, anomaly: 0, engagement: 0 },
        },
      ],
      new Set(),
      NOW,
      t
    ),
    ...generateStalePRInsights([stale], t, NOW),
    ...generateRouteInsights(
      [
        {
          routeId: 'loop',
          routeName: 'Loop',
          sportType: 'Run',
          isReverse: false,
          isRecentRecord: true,
          trend: 0,
          bestTime: 1500,
          daysSinceLast: 3,
          attemptCount: 8,
          recentEfforts: [],
        },
      ],
      { records: 1, faster: 0, slower: 0 },
      NOW,
      t
    ),
    ...generateFitnessMilestoneInsights(
      {
        previousFtp: 230,
        latestFtp: 250,
        deltaWatts: 20,
        previousDate,
        latestDate: previousDate + DAY * 2,
        sampleCount: 3,
        history: [230, 240, 250].map((value, i) => ({ value, date: previousDate + i * DAY })),
      },
      null,
      null,
      NOW,
      t
    ),
    ...generatePeriodComparisonInsights(
      week(400),
      week(300),
      week(200),
      [
        { start: DAY, stats: week(100), partial: false },
        { start: DAY * 8, stats: week(200), partial: false },
        { start: DAY * 15, stats: week(300), partial: false },
      ],
      { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3, comparedStart: 0 },
      null,
      NOW,
      t
    ),
    ...generateHrvTrendInsight(
      {
        label: 'trendingUp',
        avg: 52,
        latest: 55,
        dataPoints: 3,
        windowSplit: DAY * 2,
        sparkline: [50, 52, 55].map((value, i) => ({ value, date: DAY * (i + 1) })),
      },
      NOW,
      t
    ),
    ...generateEfficiencyTrendInsights([efficiency], NOW, t),
    ...generateSectionChangedInsights(
      [{ sectionId: 'weir', sectionName: 'Weir', kind: 'recut', at: NOW }],
      NOW,
      t
    ),
    ...generateStrengthInsights(summary(18, 8, [lopsided]), weekly, progressions, NOW, t),
  ];
}
