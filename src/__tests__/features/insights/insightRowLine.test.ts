/**
 * Scenario: the Insights list draws each card as one row holding one sentence
 * that says what changed and by how much, in the athlete's language.
 *
 * Expected behaviour: every card of every shape, as its generator writes it in
 * every locale, carries a translated sentence on one line holding the figure
 * and the change the card states, short enough in en-GB to fit a narrow phone.
 */

import { createInstance } from 'i18next';

import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateRouteInsights } from '@/features/insights/generators/routeInsights';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { printedValue } from '@/features/insights/lib/printedValue';
import type { Insight, TFunc } from '@/features/insights/types';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import { loadableLocales } from '@/i18n/localeBundles';
import type { StalePrOpportunity } from 'veloqrs';

import { insightCategories } from '../../__shared__/insightCategories';
import {
  DAY,
  NOW,
  easedOff,
  efforts,
  lopsided,
  oneOfEach,
  summary,
} from '../../__shared__/insightsOfEveryKind';
import { resolvedLocale } from '../../i18n/resolvedLocale';

/** About what one line holds at the row's type size on a 360 dp phone, names included. */
const EN_GB_LINE_CAP = 52;

async function translatorFor(locale: string): Promise<TFunc> {
  const instance = createInstance();
  await instance.init({
    lng: locale,
    resources: { [locale]: { translation: resolvedLocale(locale) } },
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance) as unknown as TFunc;
}

const week = (totalTss: number) => ({ count: 2, totalDuration: 3600, totalDistance: 1, totalTss });

function stale(sectionId: string, fitnessMetric: string, unit: string): StalePrOpportunity {
  return {
    sectionId,
    sectionName: 'Quarry',
    bestTimeSecs: 240,
    daysSinceLast: 60,
    traversalCount: 4,
    fitnessMetric,
    currentValue: fitnessMetric === 'power' ? 260 : 3.9,
    previousValue: fitnessMetric === 'power' ? 240 : 3.7,
    gainPercent: 8,
    unit,
    sportType: fitnessMetric === 'power' ? 'Ride' : 'Run',
    bestActivityId: `${sectionId}-2`,
    recentEfforts: efforts([`${sectionId}-1`, `${sectionId}-2`]),
  } as StalePrOpportunity;
}

/** The shapes the one-of-each set leaves out: groups, falls, the other sports and rules. */
function otherShapes(t: TFunc): Insight[] {
  const previousDate = 1_700_000_000;
  const paceTrend = (latestPace: number, previousPace: number) => ({
    latestPace,
    previousPace,
    gainPercent: ((latestPace - previousPace) / previousPace) * 100,
    deltaSeconds: latestPace > previousPace ? 12 : -12,
    previousDate,
    latestDate: previousDate + DAY * 2,
    sampleCount: 3,
    history: [previousPace, latestPace].map((value, i) => ({
      value,
      date: previousDate + i * DAY,
    })),
  });
  const hrv = (label: string, reason?: string) => ({
    label,
    ...(reason ? { reason } : {}),
    avg: 52,
    latest: label === 'trendingUp' ? 58 : label === 'stable' ? 52 : 46,
    dataPoints: 7,
    sparkline: [50, 52, 55].map((value, i) => ({ value, date: DAY * (i + 1) })),
  });
  const route = (routeId: string, isRecentRecord: boolean, trend: number) => ({
    routeId,
    routeName: 'Loop',
    sportType: 'Run',
    isReverse: false,
    isRecentRecord,
    trend,
    bestTime: 1500,
    daysSinceLast: 3,
    attemptCount: 8,
    recentEfforts: [],
  });
  const oneSided: typeof lopsided = {
    ...lopsided,
    rightWeightedSets: 0,
    ratio: null,
    status: 'one-sided',
  };
  const weekly = [1000, 2000, 3000, 4000].map((startTs, index) => ({
    ...summary(index + 2, index + 1, [oneSided]),
    startTs,
  }));

  return [
    ...generateSectionPRInsights(
      [
        {
          sectionId: 'ridge',
          sectionName: 'Ridge',
          sportType: 'Ride',
          bestTime: 252,
          daysAgo: 1,
          traversalCount: 4,
          previousBestTime: 258,
          deltaSeconds: 6,
          recentEfforts: [],
        },
      ],
      NOW,
      t
    ),
    ...generateFitnessMilestoneInsights(
      {
        previousFtp: 250,
        latestFtp: 230,
        deltaWatts: -20,
        previousDate,
        latestDate: previousDate + DAY * 2,
        sampleCount: 3,
        history: [],
      },
      paceTrend(3.9, 3.7),
      paceTrend(1.2, 1.3),
      NOW,
      t
    ),
    ...generatePeriodComparisonInsights(
      week(400),
      week(300),
      week(200),
      [],
      { metric: 'duration', current: 3600, previous: 2700, ratio: 1 / 3, comparedStart: 0 },
      null,
      NOW,
      t
    ),
    ...generatePeriodComparisonInsights(
      { ...week(0), count: 0 },
      week(300),
      { ...week(200), count: 8 },
      [],
      null,
      { metric: 'tss', current: 300, previous: 200, ratio: 0.5, comparedStart: 0 },
      NOW,
      t
    ),
    ...generatePeriodComparisonInsights(
      { ...week(0), count: 0 },
      week(300),
      { ...week(200), count: 8 },
      [],
      null,
      { metric: 'duration', current: 2700, previous: 3600, ratio: -0.25, comparedStart: 0 },
      NOW,
      t
    ),
    ...generateHrvTrendInsight(hrv('trendingDown'), NOW, t),
    ...generateHrvTrendInsight(hrv('trendingDown', 'lastTwoDays'), NOW, t),
    ...generateHrvTrendInsight(hrv('stable'), NOW, t),
    ...generateRouteInsights([route('hill', false, 1)], undefined, NOW, t),
    ...generateRouteInsights([route('dale', false, -1)], undefined, NOW, t),
    ...generateRouteInsights(
      [route('hill', true, 0), route('dale', false, 1), route('vale', false, -1)],
      { records: 1, faster: 1, slower: 1 },
      NOW,
      t
    ),
    ...generateStalePRInsights([stale('quarry', 'pace', '/km')], t, NOW),
    ...generateStalePRInsights([stale('pool', 'pace', '/100m')], t, NOW),
    ...generateStalePRInsights(
      [stale('quarry', 'power', 'W'), stale('ridge', 'pace', '/km')],
      t,
      NOW
    ),
    ...generateSectionChangedInsights(
      ['split', 'restored'].map((kind, i) => ({
        sectionId: `weir-${kind}`,
        sectionName: 'Weir',
        kind,
        at: NOW - i,
      })),
      NOW,
      t
    ),
    ...generateSectionChangedInsights(
      [{ sectionId: 'weir-back', sectionName: 'Weir', kind: 'reverted', at: NOW }],
      NOW,
      t
    ),
    ...generateStrengthInsights(
      summary(18, 1, [oneSided]),
      weekly,
      [{ ...easedOff, changePct: null, trend: 'up', baselineAverage: 0 }],
      NOW,
      t
    ),
  ];
}

describe.each(loadableLocales())('the row sentence in %s', (locale) => {
  let cards: Insight[] = [];

  beforeAll(async () => {
    const t = await translatorFor(locale);
    cards = [...oneOfEach(t, [easedOff]), ...otherShapes(t)];
  });

  it('is built for a card in every category', () => {
    const built = new Set(cards.map((card) => card.category));
    expect([...built].sort()).toEqual([...insightCategories()].sort());
  });

  it('is one translated line on every card', () => {
    for (const card of cards) {
      expect({ id: card.id, line: card.line }).toEqual({ id: card.id, line: expect.any(String) });
      expect(card.line.trim()).not.toBe('');
      expect(card.line).not.toMatch(/\n/);
      expect(card.line).not.toMatch(/insights\.|\{\{/);
    }
  });

  it('holds the figure and the change the card states', () => {
    for (const card of cards) {
      const { hero, change } = card.supportingData ?? {};
      if (hero)
        expect({ id: card.id, line: card.line }).toEqual({
          id: card.id,
          line: expect.stringContaining(printedValue(hero)),
        });
      if (change)
        expect({ id: card.id, line: card.line }).toEqual({
          id: card.id,
          line: expect.stringContaining(printedValue(change)),
        });
    }
  });
});

describe('the row sentence in en-GB', () => {
  it('fits one line of a narrow phone', async () => {
    const t = await translatorFor('en-GB');
    const cards = [...oneOfEach(t, [easedOff]), ...otherShapes(t)];
    const long = cards.filter((card) => card.line.length > EN_GB_LINE_CAP);
    expect(long.map((card) => `${card.id}: ${card.line}`)).toEqual([]);
  });

  it('leads a record with its place, then its time and the margin', async () => {
    const t = await translatorFor('en-GB');
    const record = otherShapes(t).find(
      (card) => card.category === 'section_pr' && card.supportingData?.sections?.[0]?.deltaSeconds
    );
    expect(record?.line).toBe('New best on Ridge, 4:12, 0:06 faster');
  });
});
