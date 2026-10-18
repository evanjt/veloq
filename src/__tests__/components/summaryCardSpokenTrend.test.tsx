/**
 * Scenario: the summary card draws an up arrow for an improvement even when
 * the number fell, so a faster threshold pace carries '↑'. A screen reader
 * reading the drawn text says "up arrow", reads the pace as a clock time, and
 * spells out HRV and RHR letter by letter.
 *
 * Expected behaviour: each tappable metric and the hero are named with the
 * judgement in words, the metric's spoken name and its value in words, and no
 * arrow reaches the accessible name.
 */

import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react-native';

import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import {
  useDashboardPreferences,
  type MetricId,
} from '@/features/settings/stores/summaryCardPreferences';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

const ARROWS = /[↑↓→▲▼]/;

/** Midnight UTC on 8 October 2026, the way the engine dates a wellness day. */
const OCT_8 = 1_791_417_600;

/** The bundle the engine hands the card, with the trend glyphs it judged and their baselines. */
function bundle(overrides: Record<string, unknown> = {}) {
  return {
    wellness: {
      fitness: 42,
      fitnessTrend: '↑',
      fitnessPrevious: 40,
      fitnessPreviousDate: OCT_8,
      form: -3,
      hrv: 61,
      hrvTrend: '↓',
      hrvPrevious: 66,
      hrvPreviousDate: OCT_8,
      rhr: 52,
      rhrTrend: '↓',
      rhrPrevious: 49,
      rhrPreviousDate: OCT_8,
    },
    currentWeek: { count: 4, totalDuration: 4 * 3600 + 6 * 60 },
    prevWeek: { count: 4, totalDuration: 4 * 3600 },
    weekHoursTrend: '→',
    weekCountTrend: '→',
    ftpTrend: { latestFtp: null, previousFtp: null },
    // 3.57 m/s is 4:40 per kilometre, faster than the 3.45 m/s before, so the
    // engine drew '↑'.
    runPaceTrend: { latestPace: 3.57, previousPace: 3.45, previousDate: OCT_8, glyph: '↑' },
    swimPaceTrend: {},
    ...overrides,
  };
}

async function renderFromHook(
  heroMetric: 'fitness' | 'hrv',
  supportingMetrics: MetricId[],
  extra: Partial<SummaryCardProps> = {}
) {
  useDashboardPreferences.setState({
    summaryCard: { ...DEFAULTS, heroMetric, supportingMetrics, showSparkline: false },
  });
  const { result } = await renderHook(() =>
    useSummaryCardData(bundle() as never, { awaitPrecomputed: true })
  );
  const tree = await render(<SummaryCard {...result.current} showSparkline={false} {...extra} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

function metricLabel(index: number): string {
  return screen.getByTestId(`summary-card-metric-${index}`).props.accessibilityLabel;
}

describe('the summary card trend for a screen reader', () => {
  it('names a faster threshold pace as improved, in words, with no arrow', async () => {
    await renderFromHook('fitness', ['thresholdPace']);

    const label = metricLabel(0);
    expect(label).toContain('improved');
    expect(label).toContain('4 minutes 40 seconds per kilometre');
    expect(label).not.toMatch(ARROWS);
    expect(label).not.toMatch(/\d:\d\d/);
  });

  it('names a resting heart rate that rose as declined, by its spoken name', async () => {
    await renderFromHook('fitness', ['rhr']);

    const label = metricLabel(0);
    expect(label).toBe('Resting heart rate 52, declined. Compared with 49 on 8 Oct.');
  });

  it('says the week hours and the week before in words, and a flat week as steady', async () => {
    await renderFromHook('fitness', ['weekHours', 'weekCount']);

    expect(metricLabel(0)).toBe(
      'Week 4 hours 6 minutes, steady. Compared with 4 hours at this point last week.'
    );
    expect(metricLabel(1)).not.toContain('#');
  });

  it('names the hero trend with its judgement', async () => {
    await renderFromHook('fitness', [], { onHeroPress: () => {} });

    const hero = screen.getByLabelText(/^Fitness/);
    expect(hero.props.accessibilityLabel).toBe('Fitness 42, improved. Compared with 40 on 8 Oct.');
  });

  it('names the HRV hero by its spoken name', async () => {
    await renderFromHook('hrv', []);

    const hero = screen.getByLabelText(/^Heart rate variability/);
    expect(hero.props.accessibilityLabel).toBe(
      'Heart rate variability 61, declined. Compared with 66 on 8 Oct.'
    );
  });
});
