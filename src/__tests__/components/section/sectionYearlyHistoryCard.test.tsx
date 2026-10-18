/**
 * Scenario: the yearly history card lists each year and its months. One year
 * holds the record, another only its own best.
 *
 * Expected behaviour: the trophy marks the record alone, in the one gold on
 * the year row and the month row alike; a year's best that is not the record
 * stays bold and draws no trophy. The card carries a header title, and each
 * month's count says what it counts.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { initialiseI18n } from '@/i18n';
import {
  SectionStatsCards,
  type CalendarSummary,
} from '@/features/routes/components/section/SectionStatsCards';
import { colors, darkColors, iconSize } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

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
      traversalCount: 3,
      activityCount: 3,
      forward: best('meadow-loop', 640),
      months: [
        { month: 4, traversalCount: 1, activityCount: 1, forward: best('orchard-lap', 660) },
        { month: 6, traversalCount: 2, activityCount: 2, forward: best('meadow-loop', 640) },
      ],
    },
    {
      year: 2025,
      traversalCount: 1,
      activityCount: 1,
      forward: best('harbour-dash', 600),
      months: [
        { month: 9, traversalCount: 1, activityCount: 1, forward: best('harbour-dash', 600) },
      ],
    },
  ],
  forwardPr: best('harbour-dash', 600),
  sectionDistance: 2000,
};

function renderCard(isDark = false) {
  return render(<SectionStatsCards calendarSummary={summary} isDark={isDark} basis="speed" />);
}

function trophies(tree: Awaited<ReturnType<typeof render>>) {
  return tree
    .UNSAFE_queryAllByType(MaterialCommunityIcons)
    .filter((icon) => icon.props.name === 'trophy');
}

describe('the yearly history card', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it("draws no trophy for a month holding the year's best that is not the record", async () => {
    const tree = await renderCard();

    // 2026 is open and holds no record; the one trophy is 2025's year row.
    expect(trophies(tree).filter((icon) => icon.props.size === iconSize.xs)).toHaveLength(0);
    expect(trophies(tree)).toHaveLength(1);
  });

  it('draws the record trophy in the one gold on the year row and the month row', async () => {
    const tree = await renderCard();
    fireEvent.press(tree.getByLabelText('Year 2025'));

    const yearTrophy = trophies(tree).filter((icon) => icon.props.size === iconSize.sm);
    const monthTrophy = trophies(tree).filter((icon) => icon.props.size === iconSize.xs);
    expect(yearTrophy).toHaveLength(1);
    expect(monthTrophy).toHaveLength(1);
    expect(yearTrophy[0].props.color).toBe(colors.achievement);
    expect(monthTrophy[0].props.color).toBe(yearTrophy[0].props.color);
  });

  it('draws the record trophy in the dark gold on a dark screen', async () => {
    const tree = await renderCard(true);
    fireEvent.press(tree.getByLabelText('Year 2025'));

    const colours = trophies(tree).map((icon) => icon.props.color);
    expect(colours).toEqual([darkColors.achievement, darkColors.achievement]);
  });

  it('carries a header title', async () => {
    const tree = await renderCard();

    const title = tree.getByTestId('section-calendar-header-title');
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.children).toBe('By year');
  });

  it("names what each month's count counts", async () => {
    const tree = await renderCard();

    expect(tree.getByText('1 traversal')).toBeTruthy();
    expect(tree.getByText('2 traversals')).toBeTruthy();
  });
});
