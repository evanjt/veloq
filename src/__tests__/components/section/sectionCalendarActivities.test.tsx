/**
 * Scenario: one March ride laps a circuit section three times, and an
 * out-and-back in April crosses it once each way.
 *
 * Expected behaviour: the year line counts the traversals the engine counted
 * and names the activities they came from, so three laps of one ride read as
 * three traversals from one activity.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';

const best = (id: string, time: number, count: number) => ({
  count,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

function summary(traversalCount: number, activityCount: number): CalendarSummary {
  return {
    years: [
      {
        year: 2026,
        traversalCount,
        activityCount,
        forward: best('loop', 380, traversalCount),
        months: [
          {
            month: 3,
            traversalCount,
            activityCount,
            forward: best('loop', 380, traversalCount),
          },
        ],
      },
    ],
    forwardPr: best('loop', 380, traversalCount),
    sectionDistance: 2000,
  };
}

function renderCards(calendar: CalendarSummary) {
  return render(
    <SectionStatsCards
      calendarSummary={calendar}
      isDark={false}
      isRunning={false}
      activityColor="#3B82F6"
    />
  );
}

describe('the calendar year line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('names the one activity three laps came from', () => {
    const { getByText } = renderCards(summary(3, 1));

    expect(getByText(/3 traversals · best .* · 1 activity$/)).toBeTruthy();
  });

  it('names several activities in the plural', () => {
    const { getByText } = renderCards(summary(5, 2));

    expect(getByText(/5 traversals · best .* · 2 activities$/)).toBeTruthy();
  });
});
