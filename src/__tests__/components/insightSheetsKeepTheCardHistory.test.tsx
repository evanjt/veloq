/**
 * Scenario: an insight card draws a history, and the sheet it opens showed
 * less of it: two values for a milestone, two bars for a week comparison, no
 * timeline for a stale record, and section-trend rows that never said which
 * bar was theirs.
 *
 * Expected behaviour: the sheet draws the card's own history at full size,
 * every sample of it, as bars when the card drew bars, and each section-trend
 * row prints the signed change its bar stands for.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { CurveChart } from '@/shared/charts';
import { initialiseI18n } from '@/i18n';
import { InsightDetailContent } from '@/features/insights/components/content/InsightDetailContent';
import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import type { Insight, InsightHistory, SectionTrendData } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn(), navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));
jest.mock('@/features/routes', () => ({
  useSectionPerformances: () => ({ records: [], bests: null, isLoading: false }),
}));

const DAY = 86_400;
const START = Date.UTC(2026, 5, 1) / 1000;

beforeAll(() => initialiseI18n('en-GB'));

async function layout() {
  const measured = screen.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  await act(async () => {
    for (const node of measured) {
      await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 150 } } });
    }
  });
}

function insight(
  category: Insight['category'],
  history: InsightHistory,
  extra: Partial<Insight['supportingData']> = {}
): Insight {
  return {
    id: category,
    category,
    priority: 2,
    title: category,
    icon: 'history',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    supportingData: { history, ...extra },
  } as Insight;
}

const dated = (values: number[], stepDays = 1) =>
  values.map((value, i) => ({ value, date: START + i * stepDays * DAY }));

/** The bars inside the sheet's history chart, which draws its grid as one picture. */
function bars() {
  return within(screen.getByTestId('insight-history-chart')).queryAllByTestId('skia-rect');
}

function chartData(): { value: number }[] {
  return screen.UNSAFE_getByType(CurveChart).props.data as { value: number }[];
}

describe('the section trend sheet', () => {
  function trend(id: string, change: number | undefined, relevance: number): SectionTrendData {
    return {
      sectionId: id,
      sectionName: `Lane ${id}`,
      trend: change == null ? 0 : Math.sign(change),
      traversalCount: 6,
      sportType: 'Ride',
      daysSinceLast: 2,
      ranking: {
        relevance,
        recency: 0.5,
        improvement: 0.5,
        anomaly: 0,
        engagement: 0.5,
        ...(change != null ? { improvementChange: change, improvementBasis: 0 } : {}),
      },
    } as SectionTrendData;
  }

  const card = () =>
    generateSectionTrendInsights(
      [trend('kiln', -0.05, 0.8), trend('weir', 0.12, 0.9), trend('moor', undefined, 0.1)],
      new Set(),
      Date.UTC(2026, 6, 1),
      ((key: string) => key) as never,
      { faster: 1, slower: 1 }
    )[0];

  it("prints each row's signed change, in the order the card draws its bars", async () => {
    const summary = card();
    await render(<InsightDetailContent insight={summary} />);

    const history = summary.supportingData?.history;
    const changes = history?.kind === 'changes' ? history.bars : [];
    const printed = changes.map(
      (bar) =>
        within(screen.getByTestId(`section-trend-toggle-${bar.key}`)).getByTestId(
          'section-trend-change'
        ).props.children
    );
    expect(printed).toEqual(['+12%', '−5%']);
  });

  it('prints no change on a row the engine compared nothing on, as its bar is absent', async () => {
    await render(<InsightDetailContent insight={card()} />);

    expect(
      within(screen.getByTestId('section-trend-toggle-moor')).queryByTestId('section-trend-change')
    ).toBeNull();
  });
});

describe('the stale record sheet', () => {
  const efforts = dated([310, 305, 300, 298, 302, 306], 9);

  it('draws every effort the card drew, the fastest at the top', async () => {
    await render(
      <InsightDetailContent
        insight={insight(
          'stale_pr',
          {
            kind: 'timeline',
            target: '/section/weir',
            series: [{ label: 'Recent efforts', points: efforts }],
          },
          { sections: [{ sectionId: 'weir', sectionName: 'Weir Path', sportType: 'Run' }] }
        )}
      />
    );
    await layout();

    expect(chartData().map((d) => d.value)).toEqual(efforts.map((p) => p.value));
    const [bottom, top] = screen.UNSAFE_getByType(CurveChart).props.yDomain as [number, number];
    expect(top).toBeLessThan(bottom);
  });
});

describe('the fitness milestone sheet', () => {
  const ftp = dated([238, 240, 241, 244, 247, 250, 252], 14);

  it('draws the whole eFTP history rather than two values', async () => {
    await render(
      <InsightDetailContent
        insight={insight(
          'fitness_milestone',
          {
            kind: 'sparkline',
            target: '/fitness',
            mark: { from: ftp[4].date, to: ftp[6].date },
            series: [{ label: 'eFTP', points: ftp }],
          },
          {
            dataPoints: [
              { label: 'Current', value: 252, unit: 'W' },
              { label: 'Previous', value: 247, unit: 'W' },
              { label: 'Change', value: '+5', unit: 'W' },
            ],
          }
        )}
      />
    );
    await layout();

    expect(chartData().map((d) => d.value)).toEqual(ftp.map((p) => p.value));
  });
});

describe('a bars history', () => {
  const weeks = dated([310, 280, 0, 350, 120], 7);
  const weekly: InsightHistory = {
    kind: 'bars',
    target: '/fitness',
    mark: { date: weeks[3].date },
    series: [{ label: 'Weekly load', points: weeks }],
  };

  it('draws one bar a week on the period comparison sheet', async () => {
    await render(
      <InsightDetailContent
        insight={insight('period_comparison', weekly, {
          comparisonData: {
            current: { label: 'This week', value: 120 },
            previous: { label: 'Last week', value: 350 },
            change: { label: 'Change', value: '-66%' },
          },
        })}
      />
    );
    await layout();

    expect(chartData().map((d) => d.value)).toEqual(weeks.map((p) => p.value));
    expect(bars()).toHaveLength(weeks.length);
  });

  it('draws bars, not a line, in the supporting data', async () => {
    await render(<SupportingDataSection data={{ history: weekly }} />);
    await layout();

    expect(bars()).toHaveLength(weeks.length);
  });

  it('stands its bars on zero', async () => {
    await render(<SupportingDataSection data={{ history: weekly }} />);
    await layout();

    const [bottom] = screen.UNSAFE_getByType(CurveChart).props.yDomain as [number, number];
    expect(bottom).toBe(0);
  });
});
