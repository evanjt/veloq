/**
 * Scenario: an insight card draws a history, and the sheet it opens showed
 * less of it: two values for a milestone, two bars for a week comparison, no
 * timeline for a stale record, and section-trend rows that never said which
 * bar was theirs.
 *
 * Expected behaviour: the sheet draws the card's own history at full size,
 * every sample of it, as bars when the card drew bars, and each section-trend
 * row prints the signed change its bar stands for. In a sheet, the chart offers
 * a screen reader the screen its history was read from, as the row no longer
 * does.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { ChartBand, CurveChart, CurveLine } from '@/shared/charts';
import { i18n, initialiseI18n } from '@/i18n';
import { navigateTo } from '@/shared/app/navigation';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import { InsightDetailContent } from '@/features/insights/components/content/InsightDetailContent';
import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import type { StalePrOpportunity } from 'veloqrs';
import type { Insight, InsightHistory, SectionTrendData } from '@/features/insights/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
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

/** A stale-record card on Weir Path whose record is the fourth of these efforts. */
function staleRecord(efforts: { value: number; date: number }[]): Insight {
  const row = {
    sectionId: 'weir',
    sectionName: 'Weir Path',
    bestTimeSecs: 298,
    traversalCount: efforts.length,
    daysSinceLast: 40,
    fitnessMetric: 'pace',
    currentValue: 4.1,
    previousValue: 3.9,
    gainPercent: 5.1,
    unit: '/km',
    sportType: 'Run',
    recentEfforts: efforts.map((p, i) => ({ ...p, activityId: `w${i + 1}` })),
    bestActivityId: 'w4',
    prDate: efforts[3].date,
    fitnessHistory: [
      { value: 3.9, date: efforts[0].date },
      { value: 4.1, date: efforts[5].date },
    ],
  } as StalePrOpportunity;
  return generateStalePRInsights([row], i18n.t.bind(i18n) as never, Date.UTC(2026, 9, 1))[0];
}

/** The bars inside the sheet's history chart, which draws its grid as one picture. */
function bars() {
  return within(screen.getByTestId('insight-history-chart')).queryAllByTestId('skia-rounded-rect');
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
    expect(printed).toEqual(['+12%', '-5%']);
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
    await render(<InsightDetailContent insight={staleRecord(efforts)} />);
    await layout();

    const chart = within(screen.getByTestId('stale-pr-efforts-chart')).UNSAFE_getByType(CurveChart);
    expect((chart.props.data as { value: number }[]).map((d) => d.value)).toEqual(
      efforts.map((p) => p.value)
    );
    const [bottom, top] = chart.props.yDomain as [number, number];
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
    await render(<SupportingDataSection data={{ history: weekly }} category="period_comparison" />);
    await layout();

    expect(bars()).toHaveLength(weeks.length);
  });

  it('stands its bars on zero', async () => {
    await render(<SupportingDataSection data={{ history: weekly }} category="period_comparison" />);
    await layout();

    const [bottom] = screen.UNSAFE_getByType(CurveChart).props.yDomain as [number, number];
    expect(bottom).toBe(0);
  });
});

describe('the section changed sheet', () => {
  const line: InsightHistory = {
    kind: 'line',
    points: [
      { lat: 46.5, lng: 6.6 },
      { lat: 46.51, lng: 6.61 },
      { lat: 46.52, lng: 6.6 },
    ],
    target: '/section/quarry',
  };

  it("draws the section's line at the sheet's width, as its card does", async () => {
    await render(<InsightDetailContent insight={insight('section_changed', line)} />);
    await layout();

    const drawing = screen.getByTestId('section-changed-line');
    expect(drawing.props.width).toBe(320);
  });

  it('opens the section from the drawing', async () => {
    const { navigateTo } = jest.requireMock('@/shared/app/navigation');
    navigateTo.mockClear();
    await render(<InsightDetailContent insight={insight('section_changed', line)} />);
    await layout();

    fireEvent.press(screen.getByTestId('section-changed-link'));
    expect(navigateTo).toHaveBeenCalledWith('/section/quarry');
  });

  it('draws nothing for a section whose line did not arrive', async () => {
    await render(
      <InsightDetailContent insight={{ ...insight('section_changed', line), supportingData: {} }} />
    );

    expect(screen.queryByTestId('section-changed-line')).toBeNull();
  });
});

describe('the window a sheet compares', () => {
  const hrv = dated([52, 55, 51, 58, 60, 57, 62]);

  /** The shaded band's edges, against the drawn x of every sample. */
  function band() {
    const bands = screen.UNSAFE_queryAllByType(ChartBand);
    const xs = (screen.UNSAFE_getAllByType(CurveLine).at(-1)?.props.points as { x: number }[]).map(
      (p) => p.x
    );
    return {
      count: bands.length,
      left: Math.min(bands[0]?.props.from, bands[0]?.props.to),
      right: Math.max(bands[0]?.props.from, bands[0]?.props.to),
      xs,
    };
  }

  it('shades the window the HRV verdict was read over', async () => {
    await render(
      <InsightDetailContent
        insight={insight('hrv_trend', {
          kind: 'sparkline',
          target: '/fitness',
          mark: { from: hrv[3].date, to: hrv[6].date },
          series: [{ label: 'HRV', points: hrv }],
        })}
      />
    );
    await layout();

    const { count, left, right, xs } = band();
    expect(count).toBe(1);
    expect(left).toBeCloseTo(xs[3]);
    expect(right).toBeCloseTo(xs[6]);
  });

  it('shades the step between two eFTP estimates', async () => {
    const ftp = dated([238, 240, 241, 244, 247, 250, 252], 14);
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

    const { count, left, right, xs } = band();
    expect(count).toBe(1);
    expect(left).toBeCloseTo(xs[4]);
    expect(right).toBeCloseTo(xs[6]);
  });

  it('marks a dated sample with the reticle and shades nothing', async () => {
    const weeks = dated([310, 280, 0, 350, 120], 7);
    await render(
      <InsightDetailContent
        insight={insight(
          'period_comparison',
          {
            kind: 'sparkline',
            target: '/fitness',
            mark: { date: weeks[3].date },
            series: [{ label: 'Weekly load', points: weeks }],
          },
          {
            comparisonData: {
              current: { label: 'This week', value: 120 },
              previous: { label: 'Last week', value: 350 },
              change: { label: 'Change', value: '-66%' },
            },
          }
        )}
      />
    );
    await layout();

    expect(band().count).toBe(0);
    expect(screen.UNSAFE_getByType(CurveChart).props.marker?.index).toBe(3);
  });
});

describe('which way a sheet chart reads', () => {
  const efforts = dated([1520, 1505, 1498, 1490, 1502], 4);

  it("opens a single route's sheet on the labelled chart, saying faster is up", async () => {
    await render(
      <InsightDetailContent
        insight={insight(
          'route',
          {
            kind: 'timeline',
            target: '/route/orchard',
            series: [{ label: 'Recent efforts', points: efforts }],
          },
          {
            routes: [
              {
                rowKey: 'orchard:Run',
                routeId: 'orchard',
                routeName: 'Orchard loop',
                sportType: 'Run',
                isRecentRecord: false,
                trend: 1,
                bestTime: 1490,
                daysSinceLast: 2,
                attemptCount: 5,
                recentEfforts: efforts,
                navigationTarget: '/route/orchard',
              },
            ],
          } as never
        )}
      />
    );
    await layout();

    const chart = screen.getByTestId('insight-history-chart');
    expect(within(chart).getByTestId('insight-series-caption').props.children).toBe('Faster is up');
    expect(chartData().map((d) => d.value)).toEqual(efforts.map((p) => p.value));
    expect(screen.getByTestId('route-insight-row-orchard:Run')).toBeTruthy();
  });

  it('prints no caption on a chart where up is more', async () => {
    const weeks = dated([310, 280, 0, 350, 120], 7);
    await render(
      <InsightDetailContent
        insight={insight(
          'period_comparison',
          {
            kind: 'bars',
            target: '/fitness',
            series: [{ label: 'Weekly load', points: weeks }],
          },
          {
            comparisonData: {
              current: { label: 'This week', value: 120 },
              previous: { label: 'Last week', value: 350 },
              change: { label: 'Change', value: '-66%' },
            },
          }
        )}
      />
    );
    await layout();

    expect(screen.getByTestId('insight-history-chart')).toBeTruthy();
    expect(screen.queryByTestId('insight-series-caption')).toBeNull();
  });
});

describe('the screen a sheet chart opens for a screen reader', () => {
  const efforts = dated([310, 305, 300, 298, 302, 306], 9);
  const stale = () => staleRecord(efforts);

  /** The efforts chart's own screen-reader element, which steps its samples. */
  function chartSurface() {
    return within(screen.getByTestId('stale-pr-efforts-chart')).UNSAFE_getByProps({
      accessibilityRole: 'adjustable',
    });
  }

  beforeEach(() => jest.mocked(navigateTo).mockClear());

  it('offers the section the history was read from, closing the sheet first', async () => {
    const onClose = jest.fn();
    await render(<InsightDetailSheet insight={stale()} onClose={onClose} />);
    await layout();

    const surface = chartSurface();
    const offered = (surface.props.accessibilityActions as { name: string; label?: string }[]).find(
      (action) => action.name === 'openPictured'
    );
    expect(offered?.label).toBe(i18n.t('insights.graphic.openSection', { name: 'Weir Path' }));

    await act(async () => {
      surface.props.onAccessibilityAction({ nativeEvent: { actionName: 'openPictured' } });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('/section/weir?activityId=w4');
  });

  it('still steps the samples beside it', async () => {
    await render(<InsightDetailSheet insight={stale()} onClose={jest.fn()} />);
    await layout();

    const names = (chartSurface().props.accessibilityActions as { name: string }[]).map(
      (action) => action.name
    );
    expect(names).toEqual(['increment', 'decrement', 'pageForward', 'pageBack', 'openPictured']);
  });

  it('offers nothing to open outside a sheet', async () => {
    await render(<InsightDetailContent insight={stale()} />);
    await layout();

    const names = (chartSurface().props.accessibilityActions as { name: string }[]).map(
      (action) => action.name
    );
    expect(names).not.toContain('openPictured');
  });
});
