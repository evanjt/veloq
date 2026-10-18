/**
 * Scenario: a 5 km running route, best 25:00 and average 26:40 on moving time,
 * whose chart plots each attempt's moving time.
 *
 * Expected behaviour: every figure beside that chart reads moving time, the
 * stats row, the Summary card, the year and month bests and the tooltip
 * headline, and never a pace the axis does not show. A section of the same
 * sport keeps reading pace.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionContentArea } from '@/features/routes/components/section/SectionContentArea';
import { SelectedAttemptCard } from '@/features/routes/components/section/SelectedAttemptCard';
import type { CalendarSummary } from '@/features/routes/components/section/SectionStatsCards';
import type { PerformanceDataPoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const DISTANCE = 5000;

const CHART_DATA = [1500, 1600, 1700].map((time, i) => ({
  id: `attempt-${i}`,
  activityId: `run-${i}`,
  activityName: `Run ${i}`,
  date: new Date(2026, 3, i + 1),
  speed: DISTANCE / time,
  sectionTime: time,
  sectionDistance: DISTANCE,
  direction: 'same',
  x: i / 2,
})) as unknown as (PerformanceDataPoint & { x: number })[];

const yearBest = {
  count: 3,
  bestTime: 1500,
  bestPace: DISTANCE / 1500,
  bestActivityId: 'run-0',
  bestActivityName: 'Run 0',
};

const CALENDAR: CalendarSummary = {
  years: [
    {
      year: 2026,
      traversalCount: 3,
      activityCount: 3,
      forward: yearBest,
      months: [{ month: 4, traversalCount: 3, activityCount: 3, forward: yearBest }],
    },
  ],
  forwardPr: yearBest,
  sectionDistance: DISTANCE,
};

function area(subject: 'route' | 'section') {
  return render(
    <SectionContentArea
      isDark={false}
      subject={subject}
      correlations={[]}
      correlationFloor={0}
      combinedChartData={CHART_DATA}
      firstActivityDate={new Date(2026, 3, 1)}
      lastActivityDate={new Date(2026, 3, 3)}
      trendCurves={{}}
      forwardStats={{
        avgTime: 1600,
        avgSpeed: DISTANCE / 1600,
        count: 3,
        lastActivity: null,
        outsideBandCount: 0,
      }}
      reverseStats={null}
      bestForwardRecord={
        {
          bestTime: 1500,
          bestPace: DISTANCE / 1500,
          activityDate: new Date(2026, 3, 1),
        } as never
      }
      bestReverseRecord={null}
      bestForwardIsRecord
      bestReverseIsRecord={false}
      calendarSummary={CALENDAR}
      effectiveSportType="Run"
      showExcluded={false}
      excludedCount={0}
      sectionTimeRange="all"
      onActivitySelect={jest.fn()}
      onExcludeActivity={jest.fn()}
      onIncludeActivity={jest.fn()}
      onSetAsReference={jest.fn()}
      onToggleShowExcluded={jest.fn()}
      onTimeRangeChange={jest.fn()}
    />
  );
}

const text = (node: { props: { children?: unknown } }) =>
  [node.props.children].flat(Infinity).join('');

describe('the figures beside a route chart', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('reads the best, the average and the yearly and monthly bests as moving time', () => {
    const { getByTestId } = area('route');

    expect(text(getByTestId('stats-row-best-forward'))).toBe('25:00');
    expect(getByTestId('section-best').props.children).toBe('25:00');
    expect(getByTestId('section-avg').props.children).toBe('26:40');
    const calendar = within(getByTestId('section-calendar'));
    expect(calendar.getByText(/^3 traversals.*25:00/)).toBeTruthy();
    expect(calendar.getByText('25:00')).toBeTruthy();
    expect(calendar.queryAllByText(/\/(mi|km)/)).toHaveLength(0);
  });

  it('keeps a section of the same sport on pace', () => {
    const { getByTestId } = area('section');

    expect(text(getByTestId('stats-row-best-forward'))).toBe('8:03 /mi');
    expect(getByTestId('section-best').props.children).toBe('8:03 /mi');
    expect(getByTestId('section-avg').props.children).toBe('8:35 /mi');
    expect(within(getByTestId('section-calendar')).getByText('8:03 /mi')).toBeTruthy();
  });
});

describe('the route attempt card', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  const point = (time: number) => ({
    ...CHART_DATA[0]!,
    speed: DISTANCE / time,
    sectionTime: time,
    recordGapSecs: time - 1500,
    isBest: false,
  });

  it('heads the selected attempt with its moving time and its gap to the record', async () => {
    const { getByTestId, queryByText } = await render(
      <SelectedAttemptCard
        attempt={point(1600)}
        isDark={false}
        activityType="Ride"
        basis="time"
        progression={[]}
        recordsSettled
      />
    );

    expect(getByTestId('selected-attempt-value')).toHaveTextContent('26:40');
    expect(getByTestId('selected-attempt-standing')).toHaveTextContent(/1:40/);
    expect(queryByText(/\/(mi|km)/)).toBeNull();
  });
});
