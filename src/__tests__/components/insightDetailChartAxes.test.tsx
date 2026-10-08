/**
 * Scenario: the HRV trend, the efficiency and strength history and the
 * section effort timeline in the insight sheets were drawn with no axis
 * title, no unit and no way to read a single sample, so they read as
 * placeholders.
 *
 * Expected behaviour: each is the shared scrubbable chart. It names the
 * series, prints value ticks in the series' unit and date ticks, and a
 * readout shows the newest sample until a scrub picks another.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

import { CurveChart } from '@/shared/charts';
import { HrvTrendContent } from '@/features/insights/components/content/HrvTrendContent';
import { SupportingDataSection } from '@/features/insights/components/SupportingDataSection';
import { SectionPerformanceTimeline } from '@/features/insights/components/content/SectionPerformanceTimeline';
import type { Insight, InsightSupportingData } from '@/features/insights/types';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import { formatDuration, formatShortDate } from '@/shared/format/format';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DAY = 86_400;
const START = Date.UTC(2026, 5, 1) / 1000;

function layout(tree: ReturnType<typeof render>) {
  const measured = tree.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  act(() => {
    for (const node of measured) {
      fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 150 } } });
    }
  });
}

const dayLabel = (epochSeconds: number) => formatShortDate(new Date(epochSeconds * 1000));

function select(tree: ReturnType<typeof render>, index: number) {
  const chart = tree.UNSAFE_getByType(CurveChart);
  const data = chart.props.data as unknown[];
  act(() => chart.props.onSelect(data[index]));
}

function hrvInsight(values: number[], days: number[]): Insight {
  return {
    id: 'hrv',
    category: 'hrv_trend',
    priority: 2,
    title: 'HRV',
    icon: 'heart-pulse',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    supportingData: {
      history: {
        kind: 'sparkline',
        target: '/fitness',
        series: [
          {
            label: 'Resting variability',
            points: values.map((value, i) => ({ value, date: START + days[i] * DAY })),
          },
        ],
      },
    },
  } as unknown as Insight;
}

describe('the HRV trend chart', () => {
  const days = [0, 1, 2, 9];
  const tree = () => {
    const t = render(<HrvTrendContent insight={hrvInsight([50, 55, 52, 58], days)} />);
    layout(t);
    return t;
  };

  it('is the shared scrubbable chart', () => {
    expect(tree().UNSAFE_getAllByType(CurveChart)).toHaveLength(1);
  });

  it('names its series and prints its ticks in milliseconds', () => {
    const t = tree();
    const chart = t.getByTestId('insight-series-chart');
    expect(t.getByText('Resting variability')).toBeTruthy();
    expect(within(chart).getByTestId('insight-series-axis-top').props.children).toMatch(/ms$/);
  });

  it('labels its first and last dates, placed on the dates they name', () => {
    const t = tree();
    const axis = within(t.getByTestId('insight-series-chart'));
    expect(axis.getByText(dayLabel(START))).toBeTruthy();
    expect(axis.getByText(dayLabel(START + 9 * DAY))).toBeTruthy();
    const xs = (t.UNSAFE_getByType(CurveChart).props.data as { x: number }[]).map((d) => d.x);
    expect(xs).toEqual(days.map((d) => START + d * DAY));
  });

  it('reads out the newest sample, then the one a scrub picks', () => {
    const t = tree();
    expect(t.getByTestId('insight-series-readout-value').props.children).toBe('58 ms');
    expect(t.getByTestId('insight-series-readout-date').props.children).toBe(
      dayLabel(START + 9 * DAY)
    );

    select(t, 0);

    expect(t.getByTestId('insight-series-readout-value').props.children).toBe('50 ms');
    expect(t.getByTestId('insight-series-readout-date').props.children).toBe(dayLabel(START));
  });
});

describe('the supporting history chart', () => {
  const data: InsightSupportingData = {
    history: {
      kind: 'bars',
      target: '/insights?tab=strength',
      series: [
        {
          label: 'Weighted sets',
          points: [12, 14, 13, 16].map((value, i) => ({ value, date: START + i * 7 * DAY })),
        },
      ],
    },
  };

  it('names its series, labels its dates and reads out a sample', () => {
    const t = render(<SupportingDataSection data={data} />);
    layout(t);

    expect(t.getByTestId('insight-series-chart')).toBeTruthy();
    expect(t.getByText('Weighted sets')).toBeTruthy();
    const axis = within(t.getByTestId('insight-series-chart'));
    expect(axis.getByText(dayLabel(START))).toBeTruthy();
    expect(axis.getByText(dayLabel(START + 21 * DAY))).toBeTruthy();
    expect(t.getByTestId('insight-series-readout-value').props.children).toBe('16');

    select(t, 1);

    expect(t.getByTestId('insight-series-readout-value').props.children).toBe('14');
  });

  it('prints a ratio with the precision its range needs', () => {
    const ratios: InsightSupportingData = {
      history: {
        kind: 'sparkline',
        target: '/section/river',
        series: [
          {
            label: 'Ratio',
            points: [1.21, 1.18, 1.16].map((value, i) => ({ value, date: START + i * DAY })),
          },
        ],
      },
    };
    const t = render(<SupportingDataSection data={ratios} />);
    layout(t);

    expect(t.getByTestId('insight-series-readout-value').props.children).toBe('1.16');
  });
});

function record(id: string, day: number, bestTime: number): SectionPerformanceRecord {
  return {
    activityId: id,
    activityName: id,
    activityDate: new Date((START + day * DAY) * 1000),
    laps: [],
    lapCount: 1,
    bestTime,
    bestPace: 5,
    bestForwardTime: bestTime,
    bestReverseTime: null,
  } as unknown as SectionPerformanceRecord;
}

describe('the section effort timeline', () => {
  const records = [record('a', 0, 300), record('b', 4, 290), record('c', 25, 310)];
  const bests = { forward: records[1], reverse: null, forwardIsPr: true, reverseIsPr: false };

  it('places efforts on their dates and puts the fastest at the top', () => {
    const t = render(<SectionPerformanceTimeline records={records} bests={bests} />);
    layout(t);

    const chart = t.UNSAFE_getByType(CurveChart);
    expect((chart.props.data as { x: number }[]).map((d) => d.x)).toEqual(
      [0, 4, 25].map((d) => START + d * DAY)
    );
    const [bottom, top] = chart.props.yDomain as [number, number];
    expect(top).toBeLessThan(290);
    expect(bottom).toBeGreaterThan(310);
  });

  it('marks the record and reads out an effort as a time and a date', () => {
    const t = render(<SectionPerformanceTimeline records={records} bests={bests} />);
    layout(t);

    expect(t.UNSAFE_getByType(CurveChart).props.marker?.index).toBe(1);
    expect(t.getByTestId('insight-series-readout-value').props.children).toBe(formatDuration(310));

    select(t, 1);

    expect(t.getByTestId('insight-series-readout-value').props.children).toBe(formatDuration(290));
    expect(t.getByTestId('insight-series-readout-date').props.children).toBe(
      dayLabel(START + 4 * DAY)
    );
  });
});
