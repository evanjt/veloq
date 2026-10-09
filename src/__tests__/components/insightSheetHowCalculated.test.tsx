/**
 * Scenario: an insight sheet printed its body, then a flat list of the
 * athlete's numbers, then the method prose and formula, all expanded, and
 * ended with no link to the data the card was computed from.
 *
 * Expected behaviour: the numbers and the method fold under one "How was this
 * calculated?" disclosure, collapsed when the sheet opens. Opened, it holds the
 * method, the formula, the numbers as rows and a link to the data, and the link
 * opens the screen that data lives on.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { StalePrOpportunity } from 'veloqrs';

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { tapTo } from '@/shared/app/navigation';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn(), navigateTo: jest.fn() }));
jest.mock('@/shared/native/useSectionDetail', () => ({
  useSectionDetail: () => ({ section: null }),
}));

const t = i18n.t.bind(i18n) as unknown as TFunc;
const DAY = 86_400;

function staleRecord(): Insight {
  const [card] = generateStalePRInsights(
    [
      {
        sectionId: 'quarry',
        sectionName: 'Quarry Climb',
        bestTimeSecs: 372,
        daysSinceLast: 40,
        traversalCount: 6,
        fitnessMetric: 'power',
        currentValue: 252,
        previousValue: 238,
        gainPercent: 6,
        unit: 'W',
        sportType: 'Ride',
        bestActivityId: 'quarry-2',
        recentEfforts: [
          { value: 390, date: DAY, activityId: 'quarry-1' },
          { value: 372, date: DAY * 2, activityId: 'quarry-2' },
          { value: 380, date: DAY * 3, activityId: 'quarry-3' },
        ],
      } as StalePrOpportunity,
    ],
    t,
    0
  );
  return card;
}

function weekOnWeek(): Insight {
  const week = (totalTss: number) => ({
    count: 3,
    totalDuration: 3600,
    totalDistance: 1,
    totalTss,
  });
  const [card] = generatePeriodComparisonInsights(
    week(400),
    week(300),
    null,
    undefined,
    { metric: 'tss', current: 400, previous: 300, ratio: 1 / 3 },
    null,
    0,
    t
  );
  return card;
}

const HOW = 'How was this calculated?';

function openSheet(insight: Insight) {
  render(<InsightDetailSheet insight={insight} onClose={() => undefined} />);
}

describe('the How was this calculated disclosure on an insight sheet', () => {
  beforeAll(() => initialiseI18n('en-GB'));
  beforeEach(() => {
    changeLanguage('en-GB');
    jest.mocked(tapTo).mockClear();
  });

  it.each([
    ['a stale record', staleRecord],
    ['a week on week comparison', weekOnWeek],
  ])('opens collapsed on %s, with none of its numbers or method showing', (_, build) => {
    const insight = build();
    openSheet(insight);

    const header = screen.getByRole('button', { name: HOW });
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });

    for (const row of insight.supportingData?.dataPoints ?? []) {
      expect(screen.queryByText(row.label)).toBeNull();
    }
    if (insight.methodology?.description) {
      expect(screen.queryByText(insight.methodology.description)).toBeNull();
    }
    expect(screen.queryByTestId('insight-data-link')).toBeNull();
  });

  it('holds the method, the formula, every number and the data link once opened', () => {
    const insight = staleRecord();
    openSheet(insight);

    fireEvent.press(screen.getByRole('button', { name: HOW }));

    expect(screen.getByRole('button', { name: HOW }).props.accessibilityState).toMatchObject({
      expanded: true,
    });
    expect(screen.getByText(insight.supportingData?.algorithmDescription as string)).toBeTruthy();
    expect(screen.getByText(insight.supportingData?.formula as string)).toBeTruthy();
    for (const row of insight.supportingData?.dataPoints ?? []) {
      expect(screen.getAllByText(row.label)).toHaveLength(1);
    }
    expect(screen.getByTestId('insight-data-link')).toBeTruthy();
  });

  it('opens the section with the record effort highlighted from the data link', () => {
    openSheet(staleRecord());

    fireEvent.press(screen.getByRole('button', { name: HOW }));
    fireEvent.press(screen.getByTestId('insight-data-link'));

    expect(tapTo).toHaveBeenCalledTimes(1);
    expect(tapTo).toHaveBeenCalledWith('/section/quarry?activityId=quarry-2');
  });

  it('names where the data link goes', () => {
    openSheet(staleRecord());

    fireEvent.press(screen.getByRole('button', { name: HOW }));

    expect(screen.getByRole('button', { name: 'Open Quarry Climb' })).toBeTruthy();
  });

  it('opens a week comparison on the fitness window it compared', () => {
    openSheet(weekOnWeek());

    fireEvent.press(screen.getByRole('button', { name: HOW }));
    fireEvent.press(screen.getByTestId('insight-data-link'));

    expect(jest.mocked(tapTo).mock.calls[0][0]).toMatch(/^\/fitness\?/);
  });
});
