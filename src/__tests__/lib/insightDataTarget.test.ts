/**
 * Scenario: an insight sheet's "How was this calculated?" ends in a link to the
 * data the card was computed from. Until it, the sheet's one such link read a
 * list of source activities no generator filled, so no sheet linked to a row.
 *
 * Expected behaviour: every category, as its generator emits it, names a
 * target that resolves to a screen, preferring what the card's graphic
 * pictures: a record's section opens with the record's effort highlighted, and
 * a summary across sections opens its top-ranked section.
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
import { insightDataTarget } from '@/features/insights/lib/dataLink';
import type { Insight, InsightCategory } from '@/features/insights/types';
import type { StrengthSummary } from '@/features/strength/types';
import type { EfficiencyTrend, StalePrOpportunity } from 'veloqrs';
import { routeFilesFor } from '../__shared__/appRoutes';
import { insightCategories } from '../__shared__/insightCategories';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const NOW = 1_700_000_000_000;
const DAY = 86_400;

const efforts = (ids: string[]) =>
  ids.map((activityId, index) => ({
    value: 260 - index * 10,
    date: DAY * (index + 1),
    activityId,
  }));

function summary(
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

const lopsided: StrengthSummary['balance'][number] = {
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

/** One card per category, each as its own generator writes it. */
function oneOfEach(): Insight[] {
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
        { start: DAY, stats: week(100) },
        { start: DAY * 8, stats: week(200) },
        { start: DAY * 15, stats: week(300) },
      ],
      { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3 },
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
    ...generateStrengthInsights(summary(18, 8, [lopsided]), weekly, [], NOW, t),
  ];
}

describe('the data an insight was computed from', () => {
  const cards = oneOfEach();

  it('builds a card in every category', () => {
    const built = new Set(cards.map((card) => card.category));
    expect([...built].sort()).toEqual([...insightCategories()].sort());
  });

  it.each(insightCategories() as InsightCategory[])(
    'a %s card links to a screen that exists',
    (category) => {
      for (const card of cards.filter((c) => c.category === category)) {
        const target = insightDataTarget(card);
        expect(target).not.toBeNull();
        expect(routeFilesFor(target as string)).not.toEqual([]);
      }
    }
  );

  it('opens a record on its section with the record effort highlighted', () => {
    const record = cards.find((card) => card.category === 'section_pr') as Insight;
    expect(insightDataTarget(record)).toBe('/section/ridge?activityId=ridge-3');
  });

  it('opens a summary across sections on its top-ranked section', () => {
    const trend = cards.find((card) => card.category === 'section_trend') as Insight;
    expect(insightDataTarget(trend)).toBe('/section/causeway');
  });

  it('opens a fitness card on the window it compared', () => {
    const fitness = cards.find((card) => card.category === 'fitness_milestone') as Insight;
    expect(insightDataTarget(fitness)).toMatch(/^\/fitness\?/);
  });

  it('names nothing for a card that carries no data', () => {
    const bare = { ...cards[0], navigationTarget: undefined, supportingData: undefined };
    expect(insightDataTarget(bare)).toBeNull();
  });
});
