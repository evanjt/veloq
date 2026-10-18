import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SummaryCard } from '@/features/home/components/SummaryCard';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { SummaryCardSection } from '@/features/settings/components/SummaryCardSection';
import {
  initialiseDashboardPreferences,
  useDashboardPreferences,
} from '@/features/settings/stores/summaryCardPreferences';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

it('offers Form as a hero in the summary card settings', async () => {
  const tree = await render(<SummaryCardSection />);
  await fireEvent.press(tree.getByRole('button', { name: 'metrics.form' }));
  expect(useDashboardPreferences.getState().summaryCard.heroMetric).toBe('form');
});

it('keeps a stored Form hero and draws its value and zone', async () => {
  await AsyncStorage.setItem(
    'dashboard_summary_card',
    JSON.stringify({ ...DEFAULTS, heroMetric: 'form' })
  );
  await initialiseDashboardPreferences();
  const card = {
    wellness: { fitness: 40, form: 8 },
    currentWeek: { count: 0, totalDuration: 0 },
    prevWeek: { count: 0, totalDuration: 0 },
    ftpTrend: { latestFtp: null, previousFtp: null },
    runPaceTrend: {},
    swimPaceTrend: {},
  };
  const sparklines = {
    fitness: [39, 40],
    fatigue: [32, 32],
    form: [7, 8],
    hrv: [],
    rhr: [],
    hrvRead: [],
    rhrRead: [],
  };
  const { result } = await renderHook(() =>
    useSummaryCardData(card, { awaitPrecomputed: true, precomputedSparklines: sparklines })
  );
  const tree = await render(<SummaryCard {...result.current} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(result.current.heroMetric).toBe('form');
  expect(tree.getByText('metrics.form')).toBeTruthy();
  expect(tree.getByText('+8')).toBeTruthy();
  expect(tree.getByText(/^formZones\./)).toBeTruthy();
  expect(tree.getByTestId('summary-card-sparkline')).toBeTruthy();

  const scrub = tree.UNSAFE_root.findAll((node) => typeof node.props.onScrub === 'function')[0]
    .props.onScrub;
  await act(() => {
    scrub({
      fitness: 39,
      fatigue: 32,
      form: 7,
      dateLabel: 'Earlier day',
    });
  });
  expect(tree.getByText('+7')).toBeTruthy();
  expect(tree.queryByText('+8')).toBeNull();

  await act(() => scrub(null));
  await tree.rerender(<SummaryCard {...result.current} showSparkline={false} />);
  expect(tree.getByText('+8')).toBeTruthy();
  expect(tree.getByText(/^formZones\./)).toBeTruthy();
});
