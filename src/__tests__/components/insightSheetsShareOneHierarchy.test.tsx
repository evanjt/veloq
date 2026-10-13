/**
 * Scenario: every insight sheet assembled itself. The context block was drawn
 * four ways, raised like a control on one kind and a bare caption on another;
 * the leading figure sat at a different size on each kind or was missing; and
 * the efficiency sheet reached its one section through four separate controls.
 *
 * Expected behaviour: every context block is the one flat card, every kind
 * whose payload carries a leading figure draws it once in the headline number
 * role and draws no other figure at that rank, and a sheet offers one control
 * per destination.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import type { EfficiencyTrend, StalePrOpportunity } from 'veloqrs';

import { initialiseI18n } from '@/i18n';
import { InsightDetailContent } from '@/features/insights/components/content/InsightDetailContent';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { tapTo } from '@/shared/app/navigation';
import { colors, layout, typography } from '@/theme';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn(), navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));
jest.mock('@/features/routes', () => ({
  useSectionPerformances: () => ({
    records: [],
    bests: { forward: null, reverse: null, forwardIsPr: false, reverseIsPr: false },
    isLoading: false,
  }),
}));

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
const NOW = 1_700_000_000_000;
const DAY = 86_400;

const efforts = [
  { value: 260, date: DAY, activityId: 'ride-1' },
  { value: 240, date: DAY * 2, activityId: 'ride-2' },
  { value: 250, date: DAY * 3, activityId: 'ride-3' },
];

const sectionPr = generateSectionPRInsights(
  [
    {
      sectionId: 'quarry',
      sectionName: 'Quarry Lane',
      bestTime: 240,
      daysAgo: 1,
      traversalCount: 4,
      bestActivityId: 'ride-2',
      recentEfforts: efforts,
    },
  ],
  NOW,
  t
)[0];

const stalePr = generateStalePRInsights(
  [
    {
      sectionId: 'quarry',
      sectionName: 'Quarry Lane',
      bestTimeSecs: 240,
      daysSinceLast: 60,
      traversalCount: 4,
      fitnessMetric: 'power',
      currentValue: 260,
      previousValue: 240,
      gainPercent: 8,
      unit: 'W',
      sportType: 'Ride',
      bestActivityId: 'ride-2',
      recentEfforts: efforts,
    } as StalePrOpportunity,
  ],
  t,
  NOW
)[0];

const hrvTrend = generateHrvTrendInsight(
  {
    label: 'trendingUp',
    avg: 52,
    latest: 55,
    dataPoints: 3,
    sparkline: [
      { value: 50, date: DAY },
      { value: 52, date: DAY * 2 },
      { value: 55, date: DAY * 3 },
    ],
  },
  NOW,
  t
)[0];

const efficiencyTrend = generateEfficiencyTrendInsights(
  [
    {
      sectionId: 'quarry',
      sectionName: 'Quarry Lane',
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
    } as EfficiencyTrend,
  ],
  NOW,
  t
)[0];

const fitnessMilestone = generateFitnessMilestoneInsights(
  {
    previousFtp: 220,
    latestFtp: 250,
    deltaWatts: 30,
    previousDate: 1_700_000_000,
    latestDate: 1_700_000_000 + DAY * 2,
    sampleCount: 3,
    history: [1, 2, 3].map((day) => ({ value: 220 + day * 10, date: 1_700_000_000 + day * DAY })),
  },
  null,
  null,
  NOW,
  t
)[0];

const week = (totalTss: number) => ({ count: 2, totalDuration: 3600, totalDistance: 1, totalTss });
const periodComparison = generatePeriodComparisonInsights(
  week(400),
  week(300),
  week(200),
  [
    { start: DAY, stats: week(100), partial: false },
    { start: DAY * 8, stats: week(200), partial: false },
    { start: DAY * 15, stats: week(300), partial: false },
  ],
  { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3, comparedStart: DAY * 15 },
  null,
  NOW,
  t
)[0];

const sectionTrend = {
  id: 'section_trend-summary',
  category: 'section_trend',
  priority: 1,
  title: 'One faster',
  icon: 'trending-up',
  iconTone: 'info',
  timestamp: 0,
  isNew: false,
  supportingData: {
    sections: [
      {
        sectionId: 'quarry',
        sectionName: 'Quarry Lane',
        bestTime: 300,
        sportType: 'Run',
        trend: 1,
      },
    ],
  },
} as Insight;

const routeInsight = {
  id: 'route-summary',
  category: 'route',
  priority: 1,
  title: 'Loop',
  icon: 'map-marker-path',
  iconTone: 'info',
  timestamp: 0,
  isNew: false,
  supportingData: {
    routes: [
      {
        rowKey: 'loop-Ride',
        routeId: 'loop',
        routeName: 'Mill Loop',
        sportType: 'Ride',
        isRecentRecord: false,
        trend: 1,
        bestTime: 900,
        daysSinceLast: 2,
        attemptCount: 5,
        navigationTarget: '/route/loop',
      },
    ],
  },
} as Insight;

type Node = { props: { style?: unknown } };

function flat<T extends object>(node: Node): T {
  return Object.assign({}, ...([node.props.style].flat(Infinity).filter(Boolean) as T[]));
}

/** Every text a render drew, with its flattened style. */
function texts(root: ReturnType<typeof render>['UNSAFE_root']) {
  return (root.findAll((n) => (n.type as unknown) === 'Text') as unknown as Node[])
    .filter((n) => n.props.style != null)
    .map((n) => ({ node: n, style: flat<TextStyle>(n) }));
}

beforeAll(() => initialiseI18n('en-GB'));
beforeEach(() => jest.mocked(tapTo).mockClear());

describe('an insight sheet', () => {
  it.each([
    ['section_trend', sectionTrend],
    ['stale_pr', stalePr],
    ['fitness_milestone', fitnessMilestone],
    ['efficiency_trend', efficiencyTrend],
    ['route', routeInsight],
  ] as const)('draws the %s context in one flat card', (_kind, insight) => {
    render(<InsightDetailContent insight={insight} />);

    const blocks = screen.getAllByTestId('sheet-context');
    expect(blocks).toHaveLength(1);
    const ground = flat<ViewStyle>(blocks[0] as unknown as Node);
    expect(ground.backgroundColor).toBe(colors.surface);
    expect(ground.borderRadius).toBe(layout.borderRadius);
    expect(ground.elevation).toBeUndefined();
    expect(ground.shadowOpacity).toBeUndefined();
    expect(ground.borderWidth).toBeUndefined();
  });

  it.each([
    ['section_pr', sectionPr, '4:00'],
    ['stale_pr', stalePr, '260'],
    ['hrv_trend', hrvTrend, '55'],
    ['efficiency_trend', efficiencyTrend, '-5'],
    ['fitness_milestone', fitnessMilestone, '250'],
    ['period_comparison', periodComparison, '400'],
  ] as const)(
    'leads the %s sheet with one figure in the headline role',
    (_kind, insight, value) => {
      render(<InsightDetailContent insight={insight} />);

      const heroes = screen.getAllByTestId('insight-hero-value');
      expect(heroes).toHaveLength(1);
      const hero = heroes[0];
      expect(hero).toHaveTextContent(new RegExp(`^${value}`));
      const style = flat<TextStyle>(hero as unknown as Node);
      expect(style.fontSize).toBe(typography.headlineNumber.fontSize);
      expect(style.fontVariant).toContain('tabular-nums');
    }
  );

  it('draws no other figure above the card title size beside the hero', () => {
    for (const insight of [sectionPr, hrvTrend, efficiencyTrend, fitnessMilestone]) {
      const view = render(<InsightDetailContent insight={insight} />);
      const hero = screen.queryByTestId('insight-hero-value') as unknown as Node | null;
      const sizes = texts(view.UNSAFE_root)
        .filter(({ node }) => node !== hero)
        .map(({ style }) => style.fontSize ?? 0)
        .filter((size) => size > typography.cardTitle.fontSize);
      expect({ category: insight.category, sizes }).toEqual({
        category: insight.category,
        sizes: [],
      });
      view.unmount();
    }
  });

  it('reaches the efficiency section through one control', async () => {
    render(<InsightDetailSheet insight={efficiencyTrend} onClose={() => undefined} />);
    await fireEvent.press(screen.getByTestId('methodology-toggle'));

    const reaching: string[] = [];
    for (const button of screen.getAllByRole('button')) {
      jest.mocked(tapTo).mockClear();
      await fireEvent.press(button);
      const target = jest.mocked(tapTo).mock.calls[0]?.[0];
      if (typeof target === 'string' && target.startsWith('/section/quarry')) {
        reaching.push(String(button.props.accessibilityLabel ?? button.props.testID));
      }
    }

    expect(reaching).toHaveLength(1);
  });

  it('keeps View in detail when it opens a screen the data link does not', async () => {
    const insight = { ...hrvTrend, navigationTarget: '/wellness' } as Insight;
    render(<InsightDetailSheet insight={insight} onClose={() => undefined} />);

    await fireEvent.press(screen.getByRole('button', { name: 'View in detail' }));

    expect(tapTo).toHaveBeenCalledWith('/wellness');
  });
});
