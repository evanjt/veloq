/**
 * Scenario: an out-and-back section whose forward climbs best 9:10 (average
 * 10:00) and whose reverse descents best 5:40 (average 6:00).
 *
 * Expected behaviour: the Summary card and the calendar year row show each
 * direction's own Best and Avg, and never a single Best or a blended Avg.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';

const record = (bestTime: number) => ({ bestTime, bestPace: 3, sectionDistance: 2000 }) as never;
const stats = (avgTime: number) => ({ avgTime, count: 10 }) as never;
const chartData = [
  { date: new Date(2026, 0, 1), x: 0 },
  { date: new Date(2026, 2, 1), x: 1 },
] as never;

function card(props: Record<string, unknown>) {
  return render(
    <SectionInfoCard
      chartData={chartData}
      bestForwardRecord={null}
      bestReverseRecord={null}
      forwardStats={null}
      reverseStats={null}
      sportType="Ride"
      isDark={false}
      {...props}
    />
  );
}

const best = (id: string, time: number) => ({
  count: 10,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

describe('direction Best and Avg', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('shows a Best and an Avg for each direction on the Summary card', () => {
    const { getByTestId, queryByText } = card({
      bestForwardRecord: record(550),
      bestReverseRecord: record(340),
      forwardStats: stats(600),
      reverseStats: stats(360),
    });

    expect(getByTestId('section-best-forward').props.children).toBe('9:10');
    expect(getByTestId('section-best-reverse').props.children).toBe('5:40');
    expect(getByTestId('section-avg-forward').props.children).toBe('10:00');
    expect(getByTestId('section-avg-reverse').props.children).toBe('6:00');
    expect(queryByText('8:00')).toBeNull();
  });

  it('keeps one Best and one Avg when only one direction has laps', () => {
    const { getAllByText, queryByTestId } = card({
      bestForwardRecord: record(550),
      forwardStats: stats(600),
    });

    expect(getAllByText('Best')).toHaveLength(1);
    expect(getAllByText('Avg')).toHaveLength(1);
    expect(queryByTestId('section-best-reverse')).toBeNull();
  });

  it('shows both directions on the calendar year row', () => {
    const calendar: CalendarSummary = {
      years: [
        {
          year: 2026,
          traversalCount: 20,
          activityCount: 10,
          forward: best('up', 550),
          reverse: best('down', 340),
          months: [],
        },
      ],
      forwardPr: best('up', 550),
      reversePr: best('down', 340),
      sectionDistance: 2000,
    };
    const { getByTestId } = render(
      <SectionStatsCards
        calendarSummary={calendar}
        isDark={false}
        isRunning={false}
        activityColor="#3B82F6"
      />
    );

    expect(getByTestId('year-best-forward-2026').props.children).toBe('9:10');
    expect(getByTestId('year-best-reverse-2026').props.children).toBe('5:40');
  });
});
