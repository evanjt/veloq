/**
 * Scenario: an insight card draws its history as a graphic across the card,
 * and the graphic opens what it pictures while the rest of the card opens the
 * sheet.
 *
 * Expected behaviour: pressing the graphic opens the history's target and not
 * the sheet, pressing the title opens the sheet and nothing else, the marked
 * point or week is the one drawn in the category colour, the scale and the
 * first and last dates are printed beside a series, and a card with no history
 * draws no graphic at all. The card names its category with a neutral icon and
 * draws no coloured edge, and the insight's own glyph keeps its verdict tone.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { Circle, RoundedRect } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { dotDisks } from '@/shared/charts/chartMarks';

import { InsightListCard } from '@/features/insights/components/InsightListCard';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import type {
  Insight,
  SectionPR,
  SectionTrendData,
  TFunc,
  WeeklyTotal,
} from '@/features/insights/types';
import { navigateTo } from '@/shared/app/navigation';
import { formatShortDate } from '@/shared/format/format';
import { insightGraphicColour } from '@/features/insights/lib/insightCategory';
import { colors, darkColors, insightToneColor, verdictColor } from '@/theme';

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

/** The icon the card draws under a test id, as the icon set receives it. */
function glyph(tree: Awaited<ReturnType<typeof render>>, testID: string) {
  const found = tree
    .UNSAFE_getAllByType(MaterialCommunityIcons)
    .find((icon) => icon.props.testID === testID);
  if (!found) throw new Error(`no icon ${testID}`);
  return found;
}

async function laidOut(tree: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent(tree.getByTestId('insight-graphic-plot'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 48 } },
    });
  });
  return tree;
}

beforeEach(() => {
  jest.mocked(navigateTo).mockClear();
  mockIsDark = false;
});

describe('the insight list card', () => {
  it('opens the section at its best effort from the graphic and not the sheet', async () => {
    const insight = sectionPrCard();
    const onPress = jest.fn();
    const tree = await render(<InsightListCard insight={insight} onPress={onPress} />);

    await fireEvent.press(tree.getByRole('link'));

    expect(navigateTo).toHaveBeenCalledWith('/section/s1?activityId=a3');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('opens the sheet from the title and pushes nothing', async () => {
    const insight = sectionPrCard();
    const onPress = jest.fn();
    const tree = await render(<InsightListCard insight={insight} onPress={onPress} />);

    await fireEvent.press(tree.getByText(insight.title));

    expect(onPress).toHaveBeenCalledWith(insight);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('names where the graphic goes', async () => {
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    expect(tree.getByRole('link').props.accessibilityLabel).toBe(
      'insights.graphic.openSection:{"name":"Orchard Lane"}'
    );
  });

  it('marks the best effort on the section timeline with the dot', async () => {
    const tree = await laidOut(
      await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />)
    );

    const marks = tree
      .UNSAFE_getAllByType(Circle)
      .filter((circle) => circle.props.r === dotDisks().fill);

    expect(marks).toHaveLength(1);
    expect(marks[0].props.color).toBe(insightGraphicColour('section_pr', false));
  });

  it('marks the best effort in the dark step on the dark theme', async () => {
    mockIsDark = true;
    const tree = await laidOut(
      await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />)
    );

    const marks = tree
      .UNSAFE_getAllByType(Circle)
      .filter((circle) => circle.props.r === dotDisks().fill);

    expect(marks).toHaveLength(1);
    expect(marks[0].props.color).toBe(insightGraphicColour('section_pr', true));
  });

  it('draws the weekly bars with only the compared week marked', async () => {
    const tree = await laidOut(
      await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />)
    );

    const bars = tree.UNSAFE_getAllByType(RoundedRect).map((bar) => bar.props.color);

    expect(bars).toHaveLength(6);
    expect(
      bars.filter((color) => color === insightGraphicColour('period_comparison', false))
    ).toHaveLength(1);
    expect(bars.filter((color) => color === colors.chartMutedBar)).toHaveLength(5);
  });

  it('draws the running week as an outline beside the whole weeks', async () => {
    const tree = await laidOut(
      await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />)
    );

    const styles = tree.UNSAFE_getAllByType(RoundedRect).map((bar) => bar.props.style ?? 'fill');

    expect(styles).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'stroke']);
  });

  it('prints the fastest and slowest times beside the timeline and its first and last dates', async () => {
    const tree = await render(<InsightListCard insight={sectionPrCard()} onPress={jest.fn()} />);

    const scale = tree.getByTestId('insight-graphic-scale');
    const dates = tree.getByTestId('insight-graphic-dates');

    expect(
      within(scale)
        .getAllByText(/./)
        .map((label) => label.props.children)
    ).toEqual(['4:41', '5:02']);
    expect(
      within(dates)
        .getAllByText(/./)
        .map((label) => label.props.children)
    ).toEqual([
      formatShortDate(new Date(PR_START * 1000)),
      formatShortDate(new Date((PR_START + 35 * DAY) * 1000)),
    ]);
  });

  it('prints the tallest week and the zero line beside the weekly bars', async () => {
    const tree = await render(<InsightListCard insight={periodCard()} onPress={jest.fn()} />);

    const scale = tree.getByTestId('insight-graphic-scale');

    expect(
      within(scale)
        .getAllByText(/./)
        .map((label) => label.props.children)
    ).toEqual(['450', '0']);
  });

  it('prints no scale and no dates beside the section changes', async () => {
    const tree = await render(<InsightListCard insight={sectionTrendCard()} onPress={jest.fn()} />);

    expect(tree.getByTestId('insight-graphic')).toBeTruthy();
    expect(tree.queryByTestId('insight-graphic-scale')).toBeNull();
    expect(tree.queryByTestId('insight-graphic-dates')).toBeNull();
  });

  it('draws no graphic and no empty frame for a card with no history', async () => {
    const insight = {
      ...periodCard(),
      supportingData: { trend: { direction: 'up', verdict: 'improved' } },
    } as Insight;
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.queryByTestId('insight-graphic')).toBeNull();
    expect(tree.queryByRole('link')).toBeNull();
    expect(tree.getByText(insight.title)).toBeTruthy();
  });

  it('shows the figure and its change in place of a graphic drawn from too few weeks', async () => {
    const insight = periodCard(5);
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(insight.supportingData?.history).toBeUndefined();
    expect(tree.queryByTestId('insight-graphic')).toBeNull();
    expect(tree.getByTestId('insight-figure').props.children).toBe('450');
    const chip = tree.getByTestId('insight-change');
    expect(within(chip).getByText('+32%')).toBeTruthy();
    expect(StyleSheet.flatten(within(chip).getByText('+32%').props.style)).toMatchObject({
      color: verdictColor('neutral', false),
    });
  });

  it('shows the figure alone where the card states no change', async () => {
    const card = periodCard(5);
    const insight = {
      ...card,
      supportingData: { hero: { label: 'This week', value: 450 } },
    } as Insight;
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId('insight-figure').props.children).toBe('450');
    expect(tree.queryByTestId('insight-change')).toBeNull();
  });

  it("draws each section's change above the line when faster and below when slower", async () => {
    const tree = await laidOut(
      await render(<InsightListCard insight={sectionTrendCard()} onPress={jest.fn()} />)
    );

    const bars = tree.UNSAFE_getAllByType(RoundedRect).filter((bar) => bar.props.height > 0);
    const faster = bars.find((bar) => bar.props.color === verdictColor('positive', false));
    const slower = bars.find((bar) => bar.props.color === verdictColor('negative', false));

    expect(bars).toHaveLength(2);
    expect(faster).toBeDefined();
    expect(slower).toBeDefined();
    expect(faster!.props.y + faster!.props.height).toBeCloseTo(slower!.props.y);
    expect(faster!.props.x).toBeLessThan(slower!.props.x);
    expect(faster!.props.height).toBeGreaterThan(slower!.props.height);
  });

  it('opens the sheet from the section changes graphic and pushes nothing', async () => {
    const insight = sectionTrendCard();
    const onPress = jest.fn();
    const tree = await render(<InsightListCard insight={insight} onPress={onPress} />);

    await fireEvent.press(tree.getByTestId('insight-graphic'));

    expect(onPress).toHaveBeenCalledWith(insight);
    expect(navigateTo).not.toHaveBeenCalled();
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

  it("keeps the insight's own glyph in its verdict tone beside the title", async () => {
    const insight = periodCard();
    const tree = await render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    const trend = glyph(tree, 'insight-trend-glyph');
    expect(trend.props.name).toBe(insight.icon);
    expect(trend.props.color).toBe(insightToneColor(insight.iconTone, false));
  });
});

describe('the insight list card label', () => {
  it('speaks the title, the new mark and the caption the card draws', () => {
    const insight = { ...sectionPrCard(), isNew: true, subtitle: 'Nine laps of the orchard' };
    const tree = render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId(`insight-card-${insight.id}`).props.accessibilityLabel).toBe(
      `${insight.title}, a11y.isNew, Nine laps of the orchard`
    );
  });

  it('speaks no new mark and no caption when the card draws neither', () => {
    const insight: Insight = { ...sectionPrCard(), isNew: false };
    delete insight.subtitle;
    const tree = render(<InsightListCard insight={insight} onPress={jest.fn()} />);

    expect(tree.getByTestId(`insight-card-${insight.id}`).props.accessibilityLabel).toBe(
      insight.title
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
