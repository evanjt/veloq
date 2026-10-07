/**
 * Scenario: one section id is ridden and run. Each sport has its own records,
 * trend and stale-PR standing, so a fact about the section is a fact about the
 * (section id, exact sport) pair.
 *
 * Expected behaviour: the pair survives the ranked fold, card ids, same-pair
 * suppression, story consolidation and the seen-fingerprint; a missing sport
 * never stands in for a known one.
 */

import { generateInsights } from '@/features/insights/lib/generateInsights';
import type { InsightInputData } from '@/features/insights/lib/generateInsights';
import {
  computeInsightsFromData,
  consolidateInsights,
} from '@/features/insights/lib/computeInsightsData';
import { sectionPairKey } from '@/features/insights/lib/sectionIdentity';
import { computeInsightFingerprint, diffInsights } from '@/features/insights/store';
import type { Insight, SectionTrendData } from '@/features/insights/types';
import type { InsightsData, StalePrOpportunity } from 'veloqrs';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const EMPTY: InsightInputData = {
  currentPeriod: null,
  previousPeriod: null,
  ftpTrend: null,
  paceTrend: null,
  recentPRs: [],
  sectionTrends: [],
};

const SECTION = 'cedar-hill';

function trend(sportType: string, over: Partial<SectionTrendData> = {}): SectionTrendData {
  return {
    sectionId: SECTION,
    sectionName: 'Cedar Hill',
    trend: sportType === 'Ride' ? 1 : -1,
    medianRecentSecs: sportType === 'Ride' ? 300 : 900,
    bestTimeSecs: sportType === 'Ride' ? 280 : 850,
    traversalCount: sportType === 'Ride' ? 12 : 7,
    sportType,
    daysSinceLast: 3,
    ...over,
  };
}

function pr(sportType: string) {
  return {
    sectionId: SECTION,
    sectionName: 'Cedar Hill',
    bestTime: sportType === 'Ride' ? 280 : 850,
    daysAgo: 4,
    sportType,
    traversalCount: sportType === 'Ride' ? 12 : 7,
    recentEfforts: [],
    previewPoints: [],
  };
}

function stale(sportType: string, id = SECTION): StalePrOpportunity {
  return {
    sectionId: id,
    sectionName: 'Cedar Hill',
    bestTimeSecs: 300,
    daysSinceLast: 60,
    traversalCount: 8,
    fitnessMetric: sportType === 'Ride' ? 'power' : 'pace',
    currentValue: sportType === 'Ride' ? 270 : 3.5,
    previousValue: sportType === 'Ride' ? 250 : 3.2,
    gainPercent: 8,
    unit: sportType === 'Ride' ? 'W' : '/km',
    sportType,
    recentEfforts: [],
  };
}

const ids = (insights: Insight[], category: string) =>
  insights.filter((i) => i.category === category).map((i) => i.id);

describe('section and sport identity', () => {
  it('keeps the sport out of the id separator and treats an absent sport as its own pair', () => {
    expect(sectionPairKey('a:b', 'Ride')).not.toBe(sectionPairKey('a', 'b:Ride'));
    expect(sectionPairKey('a|b,c#d', 'Ride')).not.toMatch(/[|,#]/);
    expect(sectionPairKey('a')).toBe('a');
    expect(sectionPairKey('a')).not.toBe(sectionPairKey('a', 'Ride'));
  });

  it('gives two PR candidates on one section different ids', () => {
    const result = generateInsights({ ...EMPTY, recentPRs: [pr('Ride'), pr('Run')] }, t);
    const prIds = ids(result, 'section_pr');
    expect(prIds).toHaveLength(2);
    expect(new Set(prIds).size).toBe(2);
  });

  it('suppresses only the trend of the sport that has a PR', () => {
    const result = generateInsights(
      { ...EMPTY, recentPRs: [pr('Ride')], sectionTrends: [trend('Ride'), trend('Run')] },
      t
    );
    const trends = result.filter((i) => i.category === 'section_trend');
    expect(trends[0].supportingData?.sections?.map((section) => section.sportType)).toEqual([
      'Run',
    ]);
  });

  it('suppresses the trend of any sport a grouped stale card names', () => {
    const result = generateInsights(
      {
        ...EMPTY,
        stalePrOpportunities: [stale('Ride'), stale('Run', 'other-hill')],
        sectionTrends: [trend('Ride'), trend('Run')],
      },
      t
    );
    const trends = result.filter((i) => i.category === 'section_trend');
    expect(trends[0].supportingData?.sections?.map((section) => section.sportType)).toEqual([
      'Run',
    ]);
  });

  it('does not let a missing sport suppress a known one', () => {
    const { sportType: _sport, ...noSport } = pr('Ride');
    const result = generateInsights(
      { ...EMPTY, recentPRs: [noSport], sectionTrends: [trend('Run')] },
      t
    );
    expect(ids(result, 'section_trend')).toHaveLength(1);
  });

  it('still suppresses a trend whose pair already has a PR', () => {
    const result = generateInsights(
      { ...EMPTY, recentPRs: [pr('Run')], sectionTrends: [trend('Run')] },
      t
    );
    expect(ids(result, 'section_trend')).toEqual([]);
  });
});

describe('consolidation by pair', () => {
  const now = Date.now();
  const base = (over: Partial<Insight>): Insight => ({
    id: 'x',
    category: 'stale_pr',
    priority: 2,
    title: 'x',
    icon: 'star',
    iconTone: 'neutral',
    timestamp: now,
    isNew: false,
    ...over,
  });
  const section = (sportType: string) => ({
    sectionId: SECTION,
    sectionName: 'Cedar Hill',
    sportType,
  });

  it('keeps a Run stale story beside a Ride PR on the same section', () => {
    const kept = consolidateInsights([
      base({ id: 'pr', category: 'section_pr', supportingData: { sections: [section('Ride')] } }),
      base({ id: 'stale', supportingData: { sections: [section('Run')] } }),
    ]);
    expect(kept.map((i) => i.id)).toEqual(['pr', 'stale']);
  });

  it('drops a Ride stale story already covered by a Ride PR', () => {
    const kept = consolidateInsights([
      base({ id: 'pr', category: 'section_pr', supportingData: { sections: [section('Ride')] } }),
      base({ id: 'stale', supportingData: { sections: [section('Ride')] } }),
    ]);
    expect(kept.map((i) => i.id)).toEqual(['pr']);
  });

  it('keeps an earlier Ride story from hiding a Run story', () => {
    const kept = consolidateInsights([
      base({ id: 'a', supportingData: { sections: [section('Ride')] } }),
      base({
        id: 'b',
        category: 'efficiency_trend',
        supportingData: { sections: [section('Run')] },
      }),
    ]);
    expect(kept.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('fold of ranked sections', () => {
  const ranked = (sportType: string) => ({
    sportType,
    sections: [
      {
        sectionId: SECTION,
        sectionName: 'Cedar Hill',
        relevanceScore: 0.9,
        recencyScore: 0.8,
        improvementScore: 0.6,
        anomalyScore: 0.1,
        engagementScore: 0.7,
        traversalCount: sportType === 'Ride' ? 12 : 7,
        bestTimeSecs: sportType === 'Ride' ? 280 : 850,
        medianRecentSecs: sportType === 'Ride' ? 300 : 900,
        daysSinceLast: 3,
        trend: sportType === 'Ride' ? 1 : -1,
        latestIsPr: false,
        recentEfforts: [],
      },
    ],
  });
  const data = (order: string[]) =>
    ({
      form: null,
      currentWeek: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
      previousWeek: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
      chronicWeekAverage: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
      chronicWeeks: [],
      recentPrs: [],
      sectionCount: 5,
      rankedSections: order.map(ranked),
      efficiencyTrends: [],
      recentSectionChanges: [],
      stalePrOpportunities: [],
      hasStrengthData: false,
    }) as unknown as InsightsData;

  it.each([
    ['Ride', 'Run'],
    ['Run', 'Ride'],
  ])('keeps both sports in either batch order (%s then %s)', (...order) => {
    const { insights } = computeInsightsFromData(data(order), t, null);
    const trends = insights.filter((i) => i.category === 'section_trend');
    expect(trends).toHaveLength(1);
    const bySport = Object.fromEntries(
      (trends[0].supportingData?.sections ?? []).map((section) => [section.sportType, section])
    );
    expect(bySport.Ride.traversalCount).toBe(12);
    expect(bySport.Run.traversalCount).toBe(7);
    expect(bySport.Ride.trend).toBe(1);
    expect(bySport.Run.trend).toBe(-1);
  });
});

describe('fingerprint of pairs', () => {
  const group = (sports: string[], gain = 8): Insight => {
    const [first] = generateInsights(
      {
        ...EMPTY,
        stalePrOpportunities: sports.map((s, i) => ({
          ...stale(s, `sec-${i}`),
          gainPercent: gain,
          currentValue: 270 + gain,
        })),
      },
      t
    ).filter((i) => i.category === 'stale_pr');
    return first;
  };
  const single = (sportType: string) =>
    generateInsights({ ...EMPTY, recentPRs: [pr(sportType)] }, t).filter(
      (i) => i.category === 'section_pr'
    );

  it('reads a replacement of Ride by Run on one section as new', () => {
    const seen = computeInsightFingerprint(single('Ride'));
    const [run] = single('Run');
    expect(diffInsights([run], seen)).toEqual(new Set([run.id]));
  });

  it('changes when a grouped member changes sport', () => {
    expect(computeInsightFingerprint([group(['Ride', 'Run'])])).not.toBe(
      computeInsightFingerprint([group(['Ride', 'Ride'])])
    );
    const seen = computeInsightFingerprint([group(['Ride', 'Run'])]);
    expect(diffInsights([group(['Ride', 'Ride'])], seen).size).toBe(1);
  });

  it('is stable under member order and changing values', () => {
    const a = group(['Ride', 'Run'], 8);
    const reordered: Insight = {
      ...a,
      supportingData: {
        ...a.supportingData,
        sections: [...(a.supportingData?.sections ?? [])].reverse(),
      },
    };
    expect(computeInsightFingerprint([reordered])).toBe(computeInsightFingerprint([a]));
    expect(diffInsights([group(['Ride', 'Run'], 15)], computeInsightFingerprint([a])).size).toBe(0);
  });

  it('reads an old section-only stored fingerprint without throwing', () => {
    const [ride] = single('Ride');
    expect(diffInsights([ride], 'section_pr-cedar-hill|stale_pr-group')).toEqual(
      new Set([ride.id])
    );
  });
});
