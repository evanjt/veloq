/**
 * Scenario: on the calendar card an overall personal best and a year's best
 * are the same trophy in two hues, and on a light surface the gold measures
 * 1.89:1. Hue alone is what told the two apart.
 *
 * Expected behaviour: the overall PR says so in text, so the row is findable
 * without reading a colour.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';

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
      forward: best('pr', 600),
      months: [{ month: 6, traversalCount: 2, activityCount: 2, forward: best('pr', 600) }],
    },
    {
      year: 2025,
      traversalCount: 2,
      activityCount: 2,
      forward: best('older', 640),
      months: [{ month: 6, traversalCount: 1, activityCount: 1, forward: best('older', 640) }],
    },
  ],
  forwardPr: best('pr', 600),
  sectionDistance: 2000,
};

function renderCards() {
  return render(
    <SectionStatsCards
      calendarSummary={summary}
      isDark={false}
      isRunning={false}
      activityColor="#3B82F6"
    />
  );
}

describe('the calendar card', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('names the overall personal best in text, not only in gold', () => {
    const { getAllByText } = renderCards();

    expect(getAllByText('PR').length).toBeGreaterThan(0);
  });
});
