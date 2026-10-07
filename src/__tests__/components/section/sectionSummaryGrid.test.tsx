/**
 * Scenario: an out-and-back section with both directions timed, on a narrow phone.
 *
 * Expected behaviour: the Summary card lays its values out two to a row, so no
 * pace has to wrap, and every value is held to one line.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';

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
      sportType="Run"
      isDark={false}
      {...props}
    />
  );
}

describe('Summary card layout', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('puts two directions in three rows of two values', () => {
    const { getByTestId, queryByTestId } = card({
      bestForwardRecord: record(550),
      bestReverseRecord: record(340),
      forwardStats: stats(600),
      reverseStats: stats(360),
    });
    for (const n of [0, 1, 2]) {
      const row = getByTestId(`section-summary-row-${n}`);
      expect(within(row).getAllByTestId(/^section-summary-cell-/)).toHaveLength(2);
    }
    expect(queryByTestId('section-summary-row-3')).toBeNull();
  });

  it('keeps a single direction to two rows of two values', () => {
    const { getByTestId, queryByTestId } = card({
      bestForwardRecord: record(550),
      forwardStats: stats(600),
    });
    expect(
      within(getByTestId('section-summary-row-1')).getAllByTestId(/^section-summary-cell-/)
    ).toHaveLength(2);
    expect(queryByTestId('section-summary-row-2')).toBeNull();
  });

  it('holds every value to one line', () => {
    const { getByTestId } = card({
      bestForwardRecord: record(550),
      bestReverseRecord: record(340),
      forwardStats: stats(600),
      reverseStats: stats(360),
    });
    for (const id of [
      'section-first',
      'section-last',
      'section-best-forward',
      'section-best-reverse',
      'section-avg-forward',
      'section-avg-reverse',
    ]) {
      expect(getByTestId(id).props.numberOfLines).toBe(1);
    }
  });
});
