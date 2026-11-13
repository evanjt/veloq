/**
 * Scenario: two supporting metrics carry one translated label, so the row
 * cannot tell its tiles apart by the label alone.
 *
 * Expected behaviour: the row keys each tile on its metric, so two tiles with
 * the same label render with no duplicate-key warning.
 */

import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { useDashboardPreferences } from '@/features/settings/stores/summaryCardPreferences';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const DAY = 86_400;
const OCT_8 = 1_791_417_600;

const CARD = {
  wellness: {
    fitness: 62,
    fitnessTrend: '↑',
    fitnessPrevious: 60,
    fitnessPreviousDate: OCT_8,
    form: 10,
    formTrend: '↓',
    formPrevious: 14,
    formPreviousDate: OCT_8,
    hrv: 52,
    hrvTrend: '↑',
    hrvPrevious: 48,
    hrvPreviousDate: OCT_8,
    rhr: 47,
    rhrTrend: '↑',
    rhrPrevious: 50,
    rhrPreviousDate: OCT_8,
    weight: 71.2,
    weightTrend: '↓',
    weightPrevious: 72,
    weightPreviousDate: OCT_8 - 6 * DAY,
  },
  currentWeek: { count: 4, totalDuration: 7200 },
  prevWeek: { count: 2, totalDuration: 3600 },
  weekHoursTrend: '↑',
  weekCountTrend: '↑',
  ftpTrend: { latestFtp: 250, previousFtp: 240, previousDate: OCT_8 - 30 * DAY, glyph: '↑' },
  runPaceTrend: {},
  swimPaceTrend: {},
};

const DEFAULTS = useDashboardPreferences.getState().summaryCard;

async function cardData(card: Parameters<typeof useSummaryCardData>[0]) {
  const { result } = await renderHook(() => useSummaryCardData(card, { awaitPrecomputed: true }));
  return result.current;
}

/** The card defers its sparklines until the first frame's interactions finish. */
async function renderCard(props: SummaryCardProps) {
  const tree = await render(<SummaryCard {...props} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

describe('the supporting row', () => {
  it('renders two tiles with one label and no duplicate-key warning', async () => {
    useDashboardPreferences.setState({
      summaryCard: {
        ...DEFAULTS,
        heroMetric: 'fitness',
        showSparkline: false,
        supportingMetrics: ['fitness', 'form'],
      },
    });
    const data = await cardData(CARD);
    const sameLabel = data.supportingMetrics.map((metric) => ({
      ...metric,
      label: 'Shared label',
    }));

    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    let tree: Awaited<ReturnType<typeof renderCard>>;
    let keyWarnings: unknown[][];
    try {
      tree = await renderCard({ ...data, supportingMetrics: sameLabel });
      keyWarnings = error.mock.calls.filter((args) => String(args[0]).includes('same key'));
    } finally {
      error.mockRestore();
    }

    expect(keyWarnings).toEqual([]);
    expect(tree.getByTestId('summary-card-metric-1')).toBeTruthy();
  });
});
