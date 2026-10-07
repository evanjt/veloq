/**
 * Scenario: the calendar card marks the reference attempt with a star alone,
 * and every month row carries a 44 point star button that makes the row tall.
 *
 * Expected behaviour: the reference attempt's row says so in text, and the
 * star button does not set the row height.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { initializeI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';

const best = (id: string, time: number) => ({
  count: 1,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

const summary: CalendarSummary = {
  years: [
    {
      year: 2026,
      traversalCount: 2,
      activityCount: 2,
      forward: best('ref', 600),
      months: [
        { month: 6, traversalCount: 1, activityCount: 1, forward: best('ref', 600) },
        { month: 5, traversalCount: 1, activityCount: 1, forward: best('other', 640) },
      ],
    },
  ],
  forwardPr: best('ref', 600),
  sectionDistance: 2000,
};

function renderCards() {
  return render(
    <SectionStatsCards
      calendarSummary={summary}
      isDark={false}
      isRunning={false}
      activityColor="#3B82F6"
      onSetAsReference={() => {}}
      referenceActivityId="ref"
    />
  );
}

describe('the calendar card reference row', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('names the reference attempt in text on its row only', () => {
    const { getAllByText } = renderCards();

    expect(getAllByText('Reference')).toHaveLength(1);
  });

  it('keeps the star button from setting the row height', () => {
    const { getAllByTestId } = renderCards();

    const buttons = getAllByTestId('calendar-reference-button');
    for (const button of buttons) {
      const style = StyleSheet.flatten(button.props.style);
      expect(style.height ?? 0).toBeLessThan(44);
    }
  });
});
