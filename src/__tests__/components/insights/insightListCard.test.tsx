/**
 * Scenario: the Insights list draws every insight as one row of one height: its
 * sentence on one line, and a small trend at the row's end only for the types
 * whose shape answers the card's question faster than its number. The full
 * history, labelled, is in the sheet the row opens.
 *
 * Expected behaviour: every card holds one text, the sentence, capped to one
 * line, and no title, caption, figure or full-width graphic. HRV, the fitness
 * estimates, a section's record timeline, a single route and the weekly-load
 * cards draw the trend; every other type draws none. The trend marks the point
 * or week the claim is about in the category colour, draws a timeline of times
 * faster up and a running week in outline, and has no press target of its own:
 * the whole row opens the sheet.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { fireEvent, render, within } from '@testing-library/react-native';
import { Circle, RoundedRect } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StalePrOpportunity } from 'veloqrs';

import { InsightListCard } from '@/features/insights/components/InsightListCard';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { generateRouteInsights } from '@/features/insights/generators/routeInsights';
import type {
  Insight,
  InsightCategory,
  SectionPR,
  SectionTrendData,
  TFunc,
  WeeklyTotal,
} from '@/features/insights/types';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthSummary } from '@/features/strength/types';
import { navigateTo } from '@/shared/app/navigation';
import {
  drawsRowTrend,
  insightCategories,
  insightGraphicColour,
} from '@/features/insights/lib/insightCategory';
import { colors, colourTokens, darkColors, insightToneColor } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const NOW = Date.UTC(2026, 8, 20);
const DAY = 86_400;
const WEEK = 7 * DAY;
const t: TFunc = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

const PR_START = NOW / 1000 - 40 * DAY;

function sectionPrCard(): Insight {
  const start = PR_START;
  const pr = {
    sectionId: 's1',
    sectionName: 'Orchard Lane',
    bestTime: 281,
    daysAgo: 3,
    traversalCount: 9,
    sportType: 'Ride',
    bestActivityId: 'a3',
    recentEfforts: [
      { value: 302, date: start, activityId: 'a1' },
      { value: 295, date: start + 7 * DAY, activityId: 'a2' },
      { value: 281, date: start + 14 * DAY, activityId: 'a3' },
      { value: 290, date: start + 21 * DAY, activityId: 'a4' },
      { value: 288, date: start + 28 * DAY, activityId: 'a5' },
      { value: 297, date: start + 35 * DAY, activityId: 'a6' },
    ],
  } as SectionPR;
  const [card] = generateSectionPRInsights([pr], NOW, t);
  if (!card) throw new Error('no section PR card');
  return card;
}

function periodCard(weekCount = 6): Insight {
  const first = NOW / 1000 - weekCount * WEEK;
  const stats = (totalTss: number) => ({
    count: 4,
    totalDuration: 4 * 3600,
    totalDistance: 100_000,
    totalTss,
  });
  const weeks: WeeklyTotal[] = [300, 320, 310, 330, 340, 450]
    .slice(-weekCount)
    .map((tss, index) => ({
      start: first + index * WEEK,
      stats: stats(tss),
      partial: index === weekCount - 1,
    }));
  const [card] = generatePeriodComparisonInsights(
    stats(450),
    stats(340),
    stats(1300),
    weeks,
    {
      metric: 'tss',
      current: 450,
      previous: 340,
      ratio: 450 / 340 - 1,
      comparedStart: first + (weekCount - 1) * WEEK,
    },
    null,
    NOW,
    t
  );
  if (!card) throw new Error('no period comparison card');
  return card;
}

function trendSection(
  sectionId: string,
  relevance: number,
  improvementChange: number | undefined
): SectionTrendData {
  return {
    sectionId,
    sectionName: `Lane ${sectionId}`,
    trend: improvementChange == null ? 0 : Math.sign(improvementChange),
    medianRecentSecs: 300,
    bestTimeSecs: 280,
    traversalCount: 6,
    sportType: 'Ride',
    daysSinceLast: 2,
    ranking: {
      relevance,
      recency: 0.5,
      improvement: 0.5,
      anomaly: 0,
      engagement: 0.5,
      improvementChange,
    },
  };
}

/** Three sections handed over out of order: one faster, one slower, one never compared. */
function sectionTrendCard(): Insight {
  const [card] = generateSectionTrendInsights(
    [
      trendSection('quarry', 0.3, undefined),
      trendSection('ford', 0.6, -0.05),
      trendSection('mill', 0.9, 0.12),
    ],
    new Set(),
    NOW,
    t,
    { faster: 1, slower: 1 }
  );
  if (!card) throw new Error('no section trend card');
  return card;
}

function strengthBalanceCard(): Insight {
  const balance: StrengthSummary['balance'] = [
    {
      id: 'push_pull',
      leftSlug: 'chest',
      rightSlug: 'upper-back',
      leftWeightedSets: 3,
      rightWeightedSets: 1.5,
      dominantSlug: 'chest',
      ratio: 2,
      status: 'imbalanced',
    },
  ];
  const week = (startTs: number): StrengthSummary => ({
    muscleVolumes: [],
    activityCount: 1,
    totalSets: 4,
    maxWeightedSets: 3,
    balance,
    startTs,
  });
  const weeks = [1, 2, 3, 4].map((index) => week(NOW / 1000 - index * WEEK));
  const card = generateStrengthInsights(week(NOW / 1000), weeks, [], NOW, t).find(
    (insight) => insight.category === 'strength_balance'
  );
  if (!card) throw new Error('no strength balance card');
  return card;
}

function hrvCard(): Insight {
  const start = NOW / 1000 - 12 * DAY;
  const readings = [48, 50, 49, 51, 52, 50, 53, 54, 52, 55, 56, 57];
  const [card] = generateHrvTrendInsight(
    {
      label: 'trendingUp',
      avg: 52,
      latest: 57,
      dataPoints: readings.length,
      windowSplit: start + 8 * DAY,
      sparkline: readings.map((value, i) => ({ value, date: start + (i + 1) * DAY })),
    },
    NOW,
    t
  );
  if (!card) throw new Error('no HRV card');
  return card;
}

function stalePrCard(): Insight {
  const [card] = generateStalePRInsights(
    [
      {
        sectionId: 'quarry',
        sectionName: 'Quarry',
        bestTimeSecs: 240,
        daysSinceLast: 60,
        traversalCount: 6,
        fitnessMetric: 'power',
        currentValue: 260,
        previousValue: 240,
        gainPercent: 8,
        unit: 'W',
        sportType: 'Ride',
        bestActivityId: 'q3',
        recentEfforts: [250, 246, 240, 244, 248, 251].map((value, i) => ({
          value,
          date: PR_START + i * 7 * DAY,
          activityId: `q${i + 1}`,
        })),
      } as StalePrOpportunity,
    ],
    t,
    NOW
  );
  if (!card) throw new Error('no stale PR card');
  return card;
}

function sectionChangedCard(): Insight {
  const [card] = generateSectionChangedInsights(
    [
      {
        sectionId: 'weir',
        sectionName: 'Weir',
        kind: 'recut',
        at: NOW,
        points: [
          { lat: 46.5, lng: 6.6 },
          { lat: 46.51, lng: 6.61 },
          { lat: 46.52, lng: 6.6 },
        ],
      },
    ],
    NOW,
    t
  );
  if (!card) throw new Error('no section changed card');
  return card;
}

function routeGroupCard(): Insight {
  const route = (routeId: string) => ({
    routeId,
    routeName: `Loop ${routeId}`,
    sportType: 'Run',
    isReverse: false,
    isRecentRecord: false,
    trend: 1,
    bestTime: 1500,
    daysSinceLast: 3,
    attemptCount: 8,
    recentEfforts: [],
  });
  const [card] = generateRouteInsights(
    [route('east'), route('west')],
    { records: 0, faster: 2, slower: 0 },
    NOW,
    t
  );
  if (!card) throw new Error('no route group card');
  return card;
}

/** The icon the card draws under a test id, as the icon set receives it. */
function glyph(tree: Awaited<ReturnType<typeof render>>, testID: string) {
  const found = tree
    .UNSAFE_getAllByType(MaterialCommunityIcons)
    .find((icon) => icon.props.testID === testID);
  if (!found) throw new Error(`no icon ${testID}`);
  return found;
}

/** The dots the trend draws in the category colour, the point the claim is about. */
function markedDots(tree: Awaited<ReturnType<typeof render>>, colour: string) {
  return within(tree.getByTestId('insight-row-trend'))
    .UNSAFE_getAllByType(Circle)
    .filter((circle) => circle.props.color === colour);
}

beforeEach(() => {
  jest.mocked(navigateTo).mockClear();
  mockIsDark = false;
});

describe('the insight row', () => {
  it.each([
    ['an HRV trend', hrvCard],
    ['a strength balance', strengthBalanceCard],
    ['a stale record', stalePrCard],
    ['a section trend summary', sectionTrendCard],
    ['a changed section', sectionChangedCard],
    ['a section record', sectionPrCard],
    ['a weekly load', periodCard],
  ])('draws %s as its sentence alone on one line', async (_, make) => {
    const insight = make();
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    const texts = tree.UNSAFE_getAllByType(Text);
    expect(texts.map((text) => text.props.children)).toEqual([insight.line]);
    expect(tree.getByText(insight.line).props.numberOfLines).toBe(1);
    expect(tree.getByText(insight.line).props.ellipsizeMode).toBe('tail');
    expect(tree.queryByTestId('insight-figure')).toBeNull();
    expect(tree.queryByTestId('insight-change')).toBeNull();
    expect(tree.queryByTestId('insight-graphic')).toBeNull();
    if (insight.subtitle) expect(tree.queryByText(insight.subtitle)).toBeNull();
  });

  it('is one height whatever the card holds', async () => {
    const heights = await Promise.all(
      [hrvCard, strengthBalanceCard, sectionChangedCard, periodCard].map(async (make) => {
        const tree = await render(<InsightListCard insight={make()} onPress={jest.fn()} />);
        return StyleSheet.flatten(tree.getByTestId('insight-row').props.style).height;
      })
    );

    expect(typeof heights[0]).toBe('number');
    expect(new Set(heights).size).toBe(1);
  });

  it.each([
    ['an HRV trend', hrvCard, true],
    ['a section record', sectionPrCard, true],
    ['a weekly load', periodCard, true],
    ['a strength balance', strengthBalanceCard, false],
    ['a stale record', stalePrCard, false],
    ['a section trend summary', sectionTrendCard, false],
    ['a changed section', sectionChangedCard, false],
    ['a route group', routeGroupCard, false],
  ])('decides whether %s draws a trend at its end', async (_, make, draws) => {
    const insight = make();
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.queryByTestId('insight-row-trend') != null).toBe(draws);
  });

  it('keeps the history the stale record and the changed sections carry for their sheets', () => {
    expect(stalePrCard().supportingData?.history?.kind).toBe('timeline');
    expect(sectionTrendCard().supportingData?.history?.kind).toBe('changes');
    expect(sectionChangedCard().supportingData?.history?.kind).toBe('line');
  });

  it('draws a weekly load too short to picture with no trend and no figure', async () => {
    const insight = periodCard(5);
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(insight.supportingData?.history).toBeUndefined();
    expect(tree.queryByTestId('insight-row-trend')).toBeNull();
    expect(tree.queryByTestId('insight-figure')).toBeNull();
    expect(tree.getByText(insight.line)).toBeTruthy();
  });

  it('draws the trend in a fixed strip that never stretches', async () => {
    const tree = await render(<InsightListCard insight={hrvCard()} onPress={jest.fn()} />);

    const strip = StyleSheet.flatten(tree.getByTestId('insight-row-trend').props.style);
    expect(typeof strip.width).toBe('number');
    expect(typeof strip.height).toBe('number');
    expect(strip.flexGrow ?? 0).toBe(0);
    expect(strip.flexShrink).toBe(0);
  });

  it('prints no scale, no dates and no value inside the trend', async () => {
    for (const make of [sectionPrCard, periodCard, hrvCard]) {
      const tree = await render(<InsightListCard insight={make()} onPress={jest.fn()} />);
      expect(within(tree.getByTestId('insight-row-trend')).queryAllByText(/./)).toEqual([]);
      expect(tree.queryByTestId('insight-graphic-scale')).toBeNull();
      expect(tree.queryByTestId('insight-graphic-dates')).toBeNull();
    }
  });

  it('marks the best effort on the section timeline in the category colour', async () => {
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    expect(markedDots(tree, insightGraphicColour('section_pr', false))).toHaveLength(1);
  });

  it('marks the best effort in the dark step on the dark theme', async () => {
    mockIsDark = true;
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    expect(markedDots(tree, insightGraphicColour('section_pr', true))).toHaveLength(1);
    expect(markedDots(tree, insightGraphicColour('section_pr', false))).toHaveLength(0);
  });

  it('draws the section timeline with the fastest effort at the top', async () => {
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    const [best] = markedDots(tree, insightGraphicColour('section_pr', false));
    const ys = within(tree.getByTestId('insight-row-trend'))
      .UNSAFE_getAllByType(Circle)
      .map((circle) => circle.props.cy);
    expect(ys.length).toBeGreaterThan(1);
    expect(best!.props.cy).toBe(Math.min(...ys));
    expect(best!.props.cy).toBeLessThan(Math.max(...ys));
  });

  it('dots the latest HRV reading in the category colour', async () => {
    const tree = await render(<InsightListCard insight={hrvCard()} onPress={jest.fn()} />);

    const dots = markedDots(tree, insightGraphicColour('hrv_trend', false));
    const xs = within(tree.getByTestId('insight-row-trend'))
      .UNSAFE_getAllByType(Circle)
      .map((circle) => circle.props.cx);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.props.cx).toBe(Math.max(...xs));
  });

  it('draws the weekly bars with only the compared week marked', async () => {
    const tree = await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />);

    const bars = within(tree.getByTestId('insight-row-trend'))
      .UNSAFE_getAllByType(RoundedRect)
      .map((bar) => bar.props.color);

    expect(bars).toHaveLength(6);
    expect(
      bars.filter((color) => color === insightGraphicColour('period_comparison', false))
    ).toHaveLength(1);
    expect(bars.filter((color) => color === colourTokens.light['chart-muted'])).toHaveLength(5);
  });

  it('draws the running week as an outline beside the whole weeks', async () => {
    const tree = await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />);

    const styles = within(tree.getByTestId('insight-row-trend'))
      .UNSAFE_getAllByType(RoundedRect)
      .map((bar) => bar.props.style ?? 'fill');

    expect(styles).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'stroke']);
  });

  it('opens the sheet from the trend and pushes nothing, since the trend is no link', async () => {
    const insight = sectionPrCard();
    const onPress = jest.fn();
    const tree = await render(<InsightListCard insight={insight} onPress={onPress} />);

    expect(tree.queryByRole('link')).toBeNull();
    await fireEvent.press(tree.getByTestId('insight-row-trend'));

    expect(onPress).toHaveBeenCalledWith(insight);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('opens the sheet from the sentence and pushes nothing', async () => {
    const insight = sectionTrendCard();
    const onPress = jest.fn();
    const tree = await render(<InsightListCard insight={insight} onPress={onPress} />);

    await fireEvent.press(tree.getByText(insight.line));

    expect(onPress).toHaveBeenCalledWith(insight);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('offers no screen-reader action to open the data, which the sheet chart carries', async () => {
    const insight = sectionPrCard();
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId(`insight-card-${insight.id}`).props.accessibilityActions).toBeFalsy();
  });
});

describe('which types draw a trend on their row', () => {
  it('names HRV, the fitness estimates, a section record, a route and the weekly load', () => {
    const drawn = (Object.keys(insightCategories) as InsightCategory[]).filter(drawsRowTrend);

    expect(drawn.sort()).toEqual(
      ['fitness_milestone', 'hrv_trend', 'period_comparison', 'route', 'section_pr'].sort()
    );
  });
});

describe('the insight list card category', () => {
  it.each([false, true])(
    'draws the category icon in the neutral icon colour (dark %s)',
    async (isDark) => {
      mockIsDark = isDark;
      const tree = await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />);

      expect(glyph(tree, 'insight-category-icon').props.color).toBe(
        (isDark ? darkColors : colors).iconSecondary
      );
    }
  );

  it.each([false, true])('draws no coloured edge down the card (dark %s)', async (isDark) => {
    mockIsDark = isDark;
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    const edges = tree
      .UNSAFE_getAllByType(View)
      .map((view) => StyleSheet.flatten(view.props.style) ?? {})
      .filter((style) => style.alignSelf === 'stretch' && style.backgroundColor != null);

    expect(edges).toEqual([]);
  });

  it("keeps the insight's own glyph in its verdict tone beside the sentence", async () => {
    const insight = periodCard();
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    const trend = glyph(tree, 'insight-trend-glyph');
    expect(trend.props.name).toBe(insight.icon);
    expect(trend.props.color).toBe(insightToneColor(insight.iconTone, false));
  });
});

describe('the insight list card label', () => {
  it('speaks the sentence, then the new mark and the experimental mark', () => {
    const insight = { ...sectionPrCard(), isNew: true, experimental: true };
    const tree = render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId(`insight-card-${insight.id}`).props.accessibilityLabel).toBe(
      `${insight.line}, a11y.isNew, common.experimental`
    );
  });

  it('speaks the sentence alone, never the title or the caption', () => {
    const insight: Insight = {
      ...sectionPrCard(),
      isNew: false,
      subtitle: 'Nine laps of the orchard',
    };
    const tree = render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId(`insight-card-${insight.id}`).props.accessibilityLabel).toBe(
      insight.line
    );
  });
});

describe('the section trend summary history', () => {
  it('carries one signed bar per compared section in the rows order', () => {
    const insight = sectionTrendCard();
    const history = insight.supportingData?.history;
    const rows = insight.supportingData?.sections?.map((row) => row.sectionId);

    expect(rows).toEqual(['mill', 'ford', 'quarry']);
    expect(history).toEqual({
      kind: 'changes',
      bars: [
        { key: 'mill', value: 0.12 },
        { key: 'ford', value: -0.05 },
      ],
    });
  });

  it('carries no history when no section was compared', () => {
    const [card] = generateSectionTrendInsights(
      [trendSection('quarry', 0.3, undefined)],
      new Set(),
      NOW,
      t,
      { faster: 0, slower: 0 }
    );

    expect(card?.supportingData?.history).toBeUndefined();
  });
});
