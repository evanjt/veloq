/**
 * Expected behaviour: a trend chart colours its series by what it measures and
 * keeps the verdict on the badge, marks one period by muting the rest, draws
 * every series in a history with a key naming each, and the eFTP trend can be
 * scrubbed with its latest value labelled at the end of the line.
 */

import React from 'react';
import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { initialiseI18n } from '@/i18n';
import { ChartBar, CurveLine } from '@/shared/charts';
import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';
import { InsightHistoryChart } from '@/features/insights/components/InsightHistoryChart';
import { PeriodComparisonContent } from '@/features/insights/components/content/PeriodComparisonContent';
import { FitnessMilestoneContent } from '@/features/insights/components/content/FitnessMilestoneContent';
import { seriesChartModel } from '@/features/insights/lib/seriesChart';
import type { InsightHistory } from '@/features/insights/types';
import { colourTokens, verdictColor } from '@/theme';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

const light = colourTokens.light;

beforeAll(async () => {
  await initialiseI18n('en-AU');
});
const WEEK = 7 * 86_400;
const FIRST_WEEK = 2_000 * WEEK;

async function layOut(tree: RenderResult) {
  const measured = tree.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onLayout === 'function'
  );
  for (const node of measured) {
    await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 200 } } });
  }
}

const step = (el: Parameters<typeof fireEvent>[0], actionName: string) =>
  fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } });

function weeks(values: number[]) {
  return values.map((value, i) => ({ value, date: FIRST_WEEK + i * WEEK }));
}

function barColours(tree: RenderResult): string[] {
  return tree.UNSAFE_getAllByType(ChartBar).map((bar) => bar.props.color as string);
}

describe('the eFTP trend', () => {
  const series = [
    { date: '2026-07-01', eftp: 240 },
    { date: '2026-08-01', eftp: 252 },
    { date: '2026-09-01', eftp: 266 },
  ];

  it('shows the latest value in the header and at the end of the line until a step picks another', async () => {
    const tree = await render(<FTPTrendChart data={series} change={26} changePercent={10.8} />);
    await layOut(tree);

    expect(tree.getByTestId('ftp-trend-value')).toHaveTextContent('266 W');
    expect(tree.getByTestId('ftp-trend-end-label')).toHaveTextContent('266 W');

    const surface = tree.getByTestId('ftp-trend-surface');
    expect(surface.props.accessibilityRole).toBe('adjustable');
    await step(surface, 'increment');

    expect(tree.getByTestId('ftp-trend-value')).toHaveTextContent('240 W');
    expect(tree.getByTestId('ftp-trend-surface').props.accessibilityValue.text).toContain('240 W');
  });

  it('draws the line in the power stream colour', async () => {
    const tree = await render(<FTPTrendChart data={series} />);
    await layOut(tree);
    const lines = tree.UNSAFE_getAllByType(CurveLine);
    expect(lines.map((line) => line.props.color)).toEqual([light['stream-power']]);
  });
});

describe('seriesChartModel with a second series', () => {
  it('carries each other series at the same sample and fits the axis to every series', () => {
    const model = seriesChartModel(weeks([4, 6, 5]), {
      formatDate: String,
      fromZero: true,
      others: [weeks([10, 2, 0])],
    });

    expect(model?.data.map((d) => d.others)).toEqual([[10], [2], [0]]);
    expect(model?.yDomain[0]).toBe(0);
    expect(model?.yDomain[1]).toBeGreaterThanOrEqual(10);
  });

  it('carries a missing value as null rather than shifting the series', () => {
    const model = seriesChartModel(weeks([4, 6, 5]), {
      formatDate: String,
      others: [weeks([10, 2])],
    });
    expect(model?.data.map((d) => d.others)).toEqual([[10], [2], [null]]);
  });
});

describe('the history sheet', () => {
  const grouped: InsightHistory = {
    kind: 'bars',
    series: [
      { label: 'Left side', points: weeks([4, 6, 5, 7]) },
      { label: 'Right side', points: weeks([3, 5, 6, 2]) },
    ],
    mark: { date: FIRST_WEEK + 3 * WEEK },
    target: '/elsewhere',
  };

  it('draws every series in the history with a key naming each', async () => {
    const tree = await render(
      <InsightHistoryChart history={grouped} category="strength_balance" />
    );
    await layOut(tree);

    expect(tree.UNSAFE_getAllByType(ChartBar)).toHaveLength(8);
    expect(tree.getByTestId('insight-series-key')).toBeTruthy();
    expect(tree.getByText('Left side')).toBeTruthy();
    expect(tree.getByText('Right side')).toBeTruthy();
  });

  it('marks the one period in the measure colour and mutes every other bar', async () => {
    const tree = await render(
      <InsightHistoryChart history={grouped} category="strength_balance" />
    );
    await layOut(tree);

    const colours = barColours(tree);
    const marked = colours.filter((colour) => colour !== light['chart-muted']);
    expect(marked).toHaveLength(2);
    expect(marked[0]).toBe(light['sport-strength']);
    expect(colours.filter((colour) => colour === light['chart-muted'])).toHaveLength(6);
  });

  it('draws a single series with no key', async () => {
    const tree = await render(
      <InsightHistoryChart
        history={{ ...grouped, series: [grouped.series[0]!] }}
        category="period_comparison"
      />
    );
    await layOut(tree);
    expect(tree.queryByTestId('insight-series-key')).toBeNull();
  });
});

describe('the sheets colour the series by what it measures, the verdict on its badge', () => {
  const history: InsightHistory = {
    kind: 'bars',
    series: [{ label: 'Weekly time', points: weeks([5, 6, 4, 3]) }],
    mark: { date: FIRST_WEEK + 3 * WEEK },
    target: '/elsewhere',
  };

  it('draws a period comparison in the chart series colour', async () => {
    const insight = {
      id: 'comparison',
      category: 'period_comparison',
      supportingData: {
        comparisonData: {
          current: { label: 'This week', value: 3 },
          previous: { label: 'Last week', value: 4 },
          change: { label: 'Change', value: '-25%' },
        },
        trend: { direction: 'down', verdict: 'declined' },
        history,
      },
    } as unknown as Insight;
    const tree = await render(<PeriodComparisonContent insight={insight} />);
    await layOut(tree);

    expect(barColours(tree)).toContain(light['chart-series']);
    expect(barColours(tree)).not.toContain(verdictColor('negative', false));
    const change = tree.getByText('-25%');
    expect(StyleSheet.flatten(change.props.style).color).toBe(verdictColor('negative', false));
  });

  it('draws a fitness milestone in the fitness colour', async () => {
    const insight = {
      id: 'milestone',
      category: 'fitness_milestone',
      supportingData: {
        dataPoints: [
          { label: 'Now', value: 266, unit: 'W' },
          { label: 'Before', value: 240, unit: 'W' },
          { label: 'Change', value: '+26', unit: 'W' },
        ],
        trend: { direction: 'up', verdict: 'improved' },
        history: {
          kind: 'sparkline',
          series: [{ label: 'eFTP', points: weeks([240, 250, 258, 266]) }],
          target: '/elsewhere',
        },
      },
    } as unknown as Insight;
    const tree = await render(<FitnessMilestoneContent insight={insight} />);
    await layOut(tree);

    const lines = tree.UNSAFE_getAllByType(CurveLine);
    expect(lines.map((line) => line.props.color)).toEqual([light['fitness-ctl']]);
  });
});
