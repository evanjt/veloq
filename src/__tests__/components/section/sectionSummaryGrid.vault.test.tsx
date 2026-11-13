/**
 * Scenario: an out-and-back section with both directions timed, on a narrow phone.
 *
 * Expected behaviour: the Summary card lays its values out two to a row, so no
 * pace has to wrap, and every value is held to one line.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';

const record = (bestTime: number) => ({ bestTime, bestPace: 3, sectionDistance: 2000 }) as never;
const stats = (avgTime: number) => ({ avgTime, count: 10 }) as never;

function card(props: Record<string, unknown>) {
  return render(
    <SectionInfoCard
      firstActivityDate={new Date(2026, 0, 1)}
      lastActivityDate={new Date(2026, 2, 1)}
      bestForwardRecord={null}
      bestReverseRecord={null}
      forwardStats={null}
      reverseStats={null}
      basis="pace"
      isDark={false}
      {...props}
    />
  );
}

describe('Summary card layout', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('puts two directions in three rows of two values', async () => {
    const { getByTestId, queryByTestId } = await card({
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

  it('keeps a single direction to two rows of two values', async () => {
    const { getByTestId, queryByTestId } = await card({
      bestForwardRecord: record(550),
      forwardStats: stats(600),
    });
    expect(
      within(getByTestId('section-summary-row-1')).getAllByTestId(/^section-summary-cell-/)
    ).toHaveLength(2);
    expect(queryByTestId('section-summary-row-2')).toBeNull();
  });

  it('holds every value to one line', async () => {
    const { getByTestId } = await card({
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

  it('carries the card title as a header, like its peer cards', async () => {
    const { getByTestId } = await card({ bestForwardRecord: record(550) });
    const title = getByTestId('section-summary-header-title');
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.children).toBe('Summary');
  });
});
