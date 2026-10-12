/**
 * Scenario: the summary's 3M and 6M ranges start on the first of a calendar
 * month, two and five months back, so they cover 61 to 184 days depending on
 * the date. Every other period picker uses the same 3M and 6M labels for a
 * trailing span of 90 and 180 days, and the summary shows no dates at all.
 *
 * Expected behaviour: the summary names both windows it compares by their
 * dates, and no chip or heading on a calendar range reads as a trailing period.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from 'i18next';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { initialiseI18n } from '@/i18n';
import { likeForLikeWindows } from '@/features/stats/lib/periodWindows';
import { PERIOD_LABEL_KEYS } from '@/shared/app/period';
import { formatFullDate } from '@/shared/format/format';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/features/fitness/hooks', () => ({
  ...jest.requireActual('@/features/fitness/hooks'),
  useAthleteSummary: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

const engine = {
  getPeriodStats: jest.fn(() => ({
    count: 3,
    totalDuration: 7200,
    totalDistance: 60000,
    totalTss: 90,
  })),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

/** Every label the shared period vocabulary shows, short and long, lower-cased. */
function trailingPeriodTexts(): Set<string> {
  const keys = [
    ...Object.values(PERIOD_LABEL_KEYS.short),
    ...Object.values(PERIOD_LABEL_KEYS.long),
  ];
  return new Set(keys.map((key) => t(key).toLowerCase()));
}

function rangeText(start: Date, end: Date): string {
  return t('stats.calendarRange', { start: formatFullDate(start), end: formatFullDate(end) });
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
  // Local noon, so the date is the 17th in every zone.
  jest.setSystemTime(new Date(2026, 5, 17, 12));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('WeeklySummary calendar windows', () => {
  it.each(['3m', '6m'] as const)(
    'shows the dates of both %s windows it compares',
    async (range) => {
      const view = await render(<WeeklySummary />, { wrapper });

      await fireEvent.press(view.getByTestId(`weekly-summary-range-${range}`));

      const windows = likeForLikeWindows(range, new Date());
      await waitFor(() =>
        expect(view.getByTestId('weekly-summary-previous-range')).toHaveTextContent(
          rangeText(windows.previousStart, windows.previousEnd)
        )
      );
      expect(view.getByTestId('weekly-summary-header-subtitle')).toHaveTextContent(
        rangeText(windows.currentStart, windows.currentEnd)
      );
    }
  );

  it('dates the three-month window from the first of the month two back', async () => {
    const view = await render(<WeeklySummary />, { wrapper });

    await fireEvent.press(view.getByTestId('weekly-summary-range-3m'));

    // Wednesday 17 June: April, May and June so far, against the same 78 days from 1 January.
    await waitFor(() =>
      expect(view.getByTestId('weekly-summary-previous-range')).toHaveTextContent(
        rangeText(new Date(2026, 0, 1), new Date(2026, 2, 19))
      )
    );
    expect(view.getByTestId('weekly-summary-header-subtitle')).toHaveTextContent(
      rangeText(new Date(2026, 3, 1), new Date(2026, 5, 17))
    );
  });

  it.each(['3m', '6m'] as const)(
    'labels the %s chip and heading apart from every trailing period',
    async (range) => {
      const view = await render(<WeeklySummary />, { wrapper });

      await fireEvent.press(view.getByTestId(`weekly-summary-range-${range}`));

      const trailing = trailingPeriodTexts();
      const heading = await waitFor(() => view.getByTestId('weekly-summary-header-title'));
      const chip = view.getByTestId(`weekly-summary-range-${range}-label`);
      const texts = [heading, chip].map((node) => String(node.props.children).toLowerCase());
      for (const text of texts) {
        expect(trailing).not.toContain(text);
        expect(text).not.toMatch(/^last /);
      }
    }
  );
});
