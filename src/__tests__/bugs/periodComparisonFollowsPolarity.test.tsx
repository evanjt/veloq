/**
 * Scenario: 400 TSS this week against 320 last week drew a positive icon on
 * the card and a green '+25%' and green bar on the sheet, and a deload week of
 * 250 drew a negative icon and an amber '-22%'. The polarity table rules load
 * out of judgement: `weekTss` is `none`, while time is `higher`.
 *
 * Expected behaviour: a load move draws the neutral rung on the card and the
 * sheet, either way, and a fall in training time draws the negative rung from
 * the verdict ladder rather than amber.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { PeriodComparisonContent } from '@/features/insights/components/content/PeriodComparisonContent';
import type { PeriodComparison, PeriodStats } from '@/features/insights/types';
import { verdictColor } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const t = (key: string) => key;

function week(count: number, totalTss: number, totalDuration: number): PeriodStats {
  return { count, totalTss, totalDuration, totalDistance: 0 };
}

function weekOverWeek(comparison: PeriodComparison) {
  const [insight] = generatePeriodComparisonInsights(
    week(5, comparison.current, comparison.current),
    week(5, comparison.previous, comparison.previous),
    null,
    undefined,
    comparison,
    null,
    0,
    t
  );
  if (!insight) throw new Error('no card');
  return insight;
}

function againstChronic(comparison: PeriodComparison) {
  const [insight] = generatePeriodComparisonInsights(
    week(0, 0, 0),
    week(4, comparison.current, comparison.current),
    week(12, comparison.previous * 4, comparison.previous * 4),
    undefined,
    null,
    comparison,
    0,
    t
  );
  if (!insight) throw new Error('no card');
  return insight;
}

/** The colour the sheet draws the change in. */
function changeColour(insight: ReturnType<typeof weekOverWeek>): string {
  const change = String(insight.supportingData?.comparisonData?.change.value);
  const { getByText } = render(<PeriodComparisonContent insight={insight} />);
  return StyleSheet.flatten(getByText(change).props.style).color as string;
}

const LOAD_RISE: PeriodComparison = { metric: 'tss', current: 400, previous: 320, ratio: 0.25 };
const LOAD_FALL: PeriodComparison = { metric: 'tss', current: 250, previous: 320, ratio: -0.22 };
const HOURS = 3600;
const TIME_FALL: PeriodComparison = {
  metric: 'duration',
  current: 6 * HOURS,
  previous: 8 * HOURS,
  ratio: -0.25,
};
const TIME_RISE: PeriodComparison = {
  metric: 'duration',
  current: 8 * HOURS,
  previous: 6 * HOURS,
  ratio: 1 / 3,
};

describe('the period comparison verdict', () => {
  it.each([
    ['a load rise', LOAD_RISE],
    ['a load fall', LOAD_FALL],
  ])('draws %s on the neutral rung, card and sheet', (_name, comparison) => {
    const insight = weekOverWeek(comparison);

    expect(insight.iconTone).toBe('neutral');
    expect(changeColour(insight)).toBe(verdictColor('neutral', false));
  });

  it('keeps the bare direction of a load move as its glyph', () => {
    expect(weekOverWeek(LOAD_RISE).icon).toBe('trending-up');
    expect(weekOverWeek(LOAD_FALL).icon).toBe('trending-down');
  });

  it('draws a fall in training time on the negative rung, not amber', () => {
    const insight = weekOverWeek(TIME_FALL);

    expect(insight.iconTone).toBe('negative');
    expect(changeColour(insight)).toBe(verdictColor('negative', false));
  });

  it('draws a rise in training time on the positive rung', () => {
    const insight = weekOverWeek(TIME_RISE);

    expect(insight.iconTone).toBe('positive');
    expect(changeColour(insight)).toBe(verdictColor('positive', false));
  });

  it('judges a week against the chronic average by the same table', () => {
    const load = againstChronic({ ...LOAD_FALL, ratio: -0.28 });
    const time = againstChronic({ ...TIME_FALL, ratio: -0.28 });

    expect(load.iconTone).toBe('neutral');
    expect(changeColour(load)).toBe(verdictColor('neutral', false));
    expect(time.iconTone).toBe('negative');
    expect(changeColour(time)).toBe(verdictColor('negative', false));
  });
});
