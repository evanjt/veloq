/**
 * Scenario: some activities on a section are still missing the time stream a
 * lap time comes from, so a faster effort may not have been read yet. The
 * stats row already shows its best as a best and not as the record.
 *
 * Expected behaviour: every other record mark on the screen holds back too,
 * the calendar's overall-record trophies, the scatter's ring and the tooltip's
 * PR mark, and all of them return once the streams are in.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Circle } from '@shopify/react-native-skia';

import { initialiseI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';
import type { PerformanceDataPoint } from '@/types';
import { colors } from '@/theme';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const best = (id: string, time: number) => ({
  count: 3,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

const summary: CalendarSummary = {
  years: [
    {
      year: 2026,
      traversalCount: 4,
      activityCount: 4,
      forward: best('quickest', 600),
      reverse: best('quickest-back', 610),
      months: [
        {
          month: 6,
          traversalCount: 2,
          activityCount: 2,
          forward: best('quickest', 600),
          reverse: best('quickest-back', 610),
        },
      ],
    },
  ],
  forwardPr: best('quickest', 600),
  reversePr: best('quickest-back', 610),
  sectionDistance: 2000,
};

function trophies(tree: Awaited<ReturnType<typeof render>>) {
  return tree
    .UNSAFE_getAllByType(MaterialCommunityIcons)
    .filter((icon) => icon.props.name === 'trophy');
}

function renderCalendar(recordsSettled: boolean) {
  return render(
    <SectionStatsCards
      calendarSummary={summary}
      isDark={false}
      basis="speed"
      activityColor="#3B82F6"
      recordsSettled={recordsSettled}
    />
  );
}

describe('the calendar card while time streams are outstanding', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('draws no overall-record trophy on the year row or the month row', async () => {
    const tree = await renderCalendar(false);

    // The month row keeps its year-best trophies, in the direction colours,
    // and never the gold overall mark or its word.
    const gold = trophies(tree).filter((icon) => icon.props.color === colors.chartGoldMark);
    expect(gold).toHaveLength(0);
    expect(tree.queryAllByText('PR')).toHaveLength(0);
    const yearTrophies = trophies(tree).filter((icon) => icon.props.size === 14);
    expect(yearTrophies).toHaveLength(0);
  });

  it('keeps the year-best mark on the month row', async () => {
    const tree = await renderCalendar(false);

    const monthTrophies = trophies(tree).filter((icon) => icon.props.size === 12);
    expect(monthTrophies.map((icon) => icon.props.color)).toEqual([
      '#3B82F6',
      colors.reverseDirection,
    ]);
  });

  it('draws the overall-record trophies once the streams are in', async () => {
    const tree = await renderCalendar(true);

    expect(trophies(tree).filter((icon) => icon.props.size === 14)).toHaveLength(2);
    expect(trophies(tree).filter((icon) => icon.props.color === colors.chartGoldMark)).toHaveLength(
      2
    );
    expect(tree.getAllByText('PR')).toHaveLength(2);
  });
});

const POINTS = [
  {
    id: 'quickest',
    activityId: 'quickest',
    date: new Date(2026, 5, 2),
    speed: 6,
    sectionTime: 200,
    isBest: true,
    direction: 'same',
    x: 0,
  },
  {
    id: 'slower',
    activityId: 'slower',
    date: new Date(2026, 5, 3),
    speed: 5,
    sectionTime: 240,
    direction: 'same',
    x: 1,
  },
] as unknown as (PerformanceDataPoint & { x: number })[];

async function scatterCircles(recordsSettled: boolean) {
  const rendered: Record<string, unknown>[] = [];
  const circleComponent = Circle as unknown as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const originalRender = circleComponent.render;
  jest.spyOn(circleComponent, 'render').mockImplementation((props, ref) => {
    rendered.push(props);
    return originalRender(props, ref);
  });
  const tree = await render(
    <SectionScatterChart
      chartData={POINTS}
      activityType="Ride"
      isDark={false}
      forwardColour="#0D9488"
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      recordsSettled={recordsSettled}
    />
  );
  await layoutViews(tree, 400, 300);
  return rendered;
}

describe('the scatter while time streams are outstanding', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws no record ring on the best point', async () => {
    const circles = await scatterCircles(false);

    expect(circles.length).toBeGreaterThan(0);
    expect(circles.filter((circle) => circle.color === colors.chartGoldMark)).toHaveLength(0);
  });

  it('rings the best point once the streams are in', async () => {
    const circles = await scatterCircles(true);

    expect(circles.filter((circle) => circle.color === colors.chartGoldMark)).toHaveLength(1);
  });
});

describe('the scrub tooltip while time streams are outstanding', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  function renderTooltip(recordsSettled: boolean) {
    return render(
      <PerformanceTooltip
        selectedPoint={POINTS[0]}
        isDark={false}
        basis="speed"
        activityColor="#000000"
        recordsSettled={recordsSettled}
        onClearSelection={() => {}}
      />
    );
  }

  it('does not call the best point a PR', async () => {
    const tree = await renderTooltip(false);

    expect(trophies(tree)).toHaveLength(0);
    expect(tree.queryAllByText('PR')).toHaveLength(0);
  });

  it('calls it a PR once the streams are in', async () => {
    const tree = await renderTooltip(true);

    expect(trophies(tree)).toHaveLength(1);
    expect(tree.getAllByText('PR')).toHaveLength(1);
  });
});
