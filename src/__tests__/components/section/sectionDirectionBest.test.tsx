/**
 * Scenario: an out-and-back section whose forward climbs best 9:10 and whose reverse descents
 * best 5:40.
 *
 * Expected behaviour: the calendar year row shows each direction's own Best, never a single one.
 * Each value names its direction in words, so no reader has to tell the two apart by the colour
 * of a dot.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';

const best = (id: string, time: number) => ({
  count: 10,
  bestTime: time,
  bestPace: 4.5,
  bestActivityId: id,
  bestActivityName: id,
});

describe('direction Best', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('shows both directions on the calendar year row', async () => {
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
    const { getByTestId } = await render(
      <SectionStatsCards calendarSummary={calendar} isDark={false} basis="speed" />
    );

    expect(getByTestId('year-best-forward-2026').props.children).toBe('9:10');
    expect(getByTestId('year-best-reverse-2026').props.children).toBe('5:40');
  });

  vaultIt('names each direction in words on the calendar year row and month entries', async () => {
    const calendar: CalendarSummary = {
      years: [
        {
          year: 2026,
          traversalCount: 20,
          activityCount: 10,
          forward: best('up', 550),
          reverse: best('down', 340),
          months: [
            {
              month: 4,
              traversalCount: 2,
              activityCount: 1,
              forward: best('up', 550),
              reverse: best('down', 340),
            },
          ],
        },
      ],
      forwardPr: best('up', 550),
      reversePr: best('down', 340),
      sectionDistance: 2000,
    };
    const { getAllByText, getByLabelText } = await render(
      <SectionStatsCards calendarSummary={calendar} isDark={false} basis="speed" />
    );
    fireEvent.press(getByLabelText('Year 2026'));

    expect(getAllByText(/Forward/).length).toBeGreaterThan(0);
    expect(getAllByText(/Reverse/).length).toBeGreaterThan(0);
    expect(getByLabelText(/Forward.*9:10.*up/)).toBeTruthy();
    expect(getByLabelText(/Reverse.*5:40.*down/)).toBeTruthy();
  });
});
