/**
 * Scenario: the summary card as the feed draws it, from the hook's answer.
 *
 * Expected behaviour: the fitness sparkline needs two days as the HRV one
 * does, the hero's form and the supporting row's form print one number on a
 * half-unit day, and every supporting metric opens its own chart.
 */

import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';

import { GestureDetector } from 'react-native-gesture-handler';

import { SummaryCard, type SummaryCardProps } from '@/features/home/components/SummaryCard';
import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import { useSummaryCardData } from '@/features/home/hooks/useSummaryCardData';
import { summaryCardTarget } from '@/features/home/lib/summaryCardTargets';
import { useDashboardPreferences, type MetricId } from '@/features/home/store';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
const mockFormBar = jest.fn();
jest.mock('@/features/home/lib/formBar', () => {
  const actual = jest.requireActual('@/features/home/lib/formBar');
  return {
    formBarLayout: (...args: unknown[]) => {
      mockFormBar(...args);
      return actual.formBarLayout(...args);
    },
  };
});

/** The card defers its sparklines until the first frame's interactions finish. */
async function renderCard(props: Partial<SummaryCardProps>) {
  const tree = render(
    <SummaryCard
      onProfilePress={() => {}}
      heroValue={0}
      heroLabel="metrics.fitness"
      heroColor="#000"
      showSparkline
      supportingMetrics={[]}
      {...props}
    />
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree;
}

const DEFAULTS = useDashboardPreferences.getState().summaryCard;
afterEach(() => useDashboardPreferences.setState({ summaryCard: DEFAULTS }));

describe('the fitness sparkline', () => {
  it('mounts no row on a single day, as the HRV one does not', async () => {
    const one = await renderCard({ fitnessData: [40], fatigueData: [42], formData: [-2] });
    expect(one.queryByTestId('summary-card-sparkline')).toBeNull();

    const hrv = await renderCard({ heroMetric: 'hrv', hrvData: [55], rhrData: [48] });
    expect(hrv.queryByTestId('summary-card-hrv-sparkline')).toBeNull();
  });

  it('draws nothing of its own on a single day, whoever mounts it', () => {
    const tree = render(
      <SummaryCardSparkline fitnessData={[40]} fatigueData={[42]} formData={[-2]} width={300} />
    );

    expect(tree.UNSAFE_queryAllByType(GestureDetector)).toHaveLength(0);
  });

  it('mounts on two days', async () => {
    const two = await renderCard({
      fitnessData: [40, 41],
      fatigueData: [42, 41],
      formData: [-2, 0],
    });
    expect(two.getByTestId('summary-card-sparkline')).toBeTruthy();

    const hrv = await renderCard({ heroMetric: 'hrv', hrvData: [55, 57], rhrData: [48, 47] });
    expect(hrv.getByTestId('summary-card-hrv-sparkline')).toBeTruthy();
  });
});

describe('the form bar under the fitness sparkline', () => {
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  it.each([true, false])(
    'zones each day on its own fitness with form as percent %s',
    (asPercent) => {
      useFormPreference.setState({ formAsPercent: asPercent });
      mockFormBar.mockClear();

      render(<SummaryCardSparkline fitnessData={[40, 100]} formData={[-8, -8]} width={300} />);

      expect(mockFormBar).toHaveBeenLastCalledWith([-8, -8], [40, 100], asPercent, 300);
    }
  );
});

describe('form on a half-unit day', () => {
  // What the engine answers for each day's loads: `sparklines_to` rounds each
  // load and subtracts, and the bundle's `summary` does the same, which
  // tests/wellness_form_rounding.rs pins. A renderer that re-derived form from
  // the raw loads would print 10 for the first.
  it.each([
    ['ctl 50.5, atl 40.4', { fitness: 51, fatigue: 40, form: 11 }],
    ['ctl 40.5, atl 30.5', { fitness: 41, fatigue: 31, form: 10 }],
  ])('prints one form for %s in the hero and the supporting row', async (_day, day) => {
    useDashboardPreferences.setState({
      summaryCard: { ...DEFAULTS, heroMetric: 'fitness', supportingMetrics: ['form'] },
    });
    const card = {
      wellness: { fitness: day.fitness, form: day.form },
      currentWeek: { count: 0, totalDuration: 0 },
      prevWeek: { count: 0, totalDuration: 0 },
      ftpTrend: { latestFtp: null, previousFtp: null },
      runPaceTrend: {},
      swimPaceTrend: {},
    };
    const sparklines = {
      fitness: [day.fitness - 1, day.fitness],
      fatigue: [day.fatigue, day.fatigue],
      form: [day.fitness - 1 - day.fatigue, day.form],
      hrv: [],
      rhr: [],
      hrvRead: [],
      rhrRead: [],
    };
    const { result } = renderHook(() =>
      useSummaryCardData(card, { awaitPrecomputed: true, precomputedSparklines: sparklines })
    );

    const tree = await renderCard(result.current);

    const printed = `+${day.form}`;
    expect(tree.getByText(new RegExp(`^\\${printed} formZones\\.`))).toBeTruthy();
    expect(tree.getByTestId('summary-card-metric-0')).toHaveTextContent(`metrics.form${printed}`);
  });
});

describe('form under the percentage preference', () => {
  afterEach(() => useFormPreference.setState({ formAsPercent: null }));

  function supportingForm(fitness: number, form: number) {
    useDashboardPreferences.setState({
      summaryCard: { ...DEFAULTS, heroMetric: 'fitness', supportingMetrics: ['form'] },
    });
    const card = {
      wellness: { fitness, form },
      currentWeek: { count: 0, totalDuration: 0 },
      prevWeek: { count: 0, totalDuration: 0 },
      ftpTrend: { latestFtp: null, previousFtp: null },
      runPaceTrend: {},
      swimPaceTrend: {},
    };
    const sparklines = {
      fitness: [fitness, fitness],
      fatigue: [fitness - form, fitness - form],
      form: [form, form],
      hrv: [],
      rhr: [],
      hrvRead: [],
      rhrRead: [],
    };
    return renderHook(() =>
      useSummaryCardData(card, { awaitPrecomputed: true, precomputedSparklines: sparklines })
    ).result.current.supportingMetrics[0].value;
  }

  it('prints the supporting form as a signed percentage of fitness', () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(supportingForm(40, -8)).toBe('-20%');
  });

  it('prints no number when fitness is zero', () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(supportingForm(0, -8)).toBe('-');
  });

  it('prints the absolute number with the preference off', () => {
    useFormPreference.setState({ formAsPercent: false });
    expect(supportingForm(40, -8)).toBe('-8');
  });
});

describe('a tap on a supporting metric', () => {
  const EVERY: MetricId[] = ['fitness', 'ftp', 'weekHours', 'weekCount'];

  it.each(EVERY)('opens the chart %s summarises', async (metric) => {
    useDashboardPreferences.setState({ summaryCard: { ...DEFAULTS, supportingMetrics: [metric] } });
    const { result } = renderHook(() => useSummaryCardData());
    const tree = await renderCard({ supportingMetrics: result.current.supportingMetrics });

    fireEvent.press(tree.getByTestId('summary-card-metric-0'));

    expect(router.push).toHaveBeenLastCalledWith(summaryCardTarget(metric));
  });
});
