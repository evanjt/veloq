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
import {
  useDashboardPreferences,
  type MetricId,
} from '@/features/settings/stores/summaryCardPreferences';
import { ABSENT } from '@/shared/format/absent';
import { colors } from '@/theme';
import { summaryCardBundle } from '../__shared__/summaryCardBundle';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
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
  const tree = await render(
    <SummaryCard
      heroValue={0}
      heroLabel="metrics.fitness"
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

describe('the way into settings', () => {
  vaultIt('is not on the card, since Settings is a tab of its own', async () => {
    const tree = await renderCard({
      fitnessData: [40, 41],
      fatigueData: [42, 43],
      formData: [-2, -2],
      formZoneData: ['greyZone', 'greyZone'],
      formTextData: ['-2', '-2'],
    });
    expect(tree.queryByLabelText('common.openSettings')).toBeNull();
  });
});

describe('the fitness sparkline', () => {
  vaultIt('mounts no row on a single day, as the HRV one does not', async () => {
    const one = await renderCard({
      fitnessData: [40],
      fatigueData: [42],
      formData: [-2],
      formZoneData: ['greyZone'],
      formTextData: ['-2'],
    });
    expect(one.queryByTestId('summary-card-sparkline')).toBeNull();

    const hrv = await renderCard({ heroMetric: 'hrv', hrvData: [55], rhrData: [48] });
    expect(hrv.queryByTestId('summary-card-hrv-sparkline')).toBeNull();
  });

  vaultIt('draws nothing of its own on a single day, whoever mounts it', async () => {
    const tree = await render(
      <SummaryCardSparkline
        fitnessData={[40]}
        fatigueData={[42]}
        formData={[-2]}
        formZoneData={['greyZone']}
        formTextData={['-2']}
        width={300}
      />
    );

    expect(tree.UNSAFE_queryAllByType(GestureDetector)).toHaveLength(0);
  });

  vaultIt('mounts on two days', async () => {
    const two = await renderCard({
      fitnessData: [40, 41],
      fatigueData: [42, 41],
      formData: [-2, 0],
      formZoneData: ['greyZone', 'greyZone'],
      formTextData: ['-2', '0'],
    });
    expect(two.getByTestId('summary-card-sparkline')).toBeTruthy();

    const hrv = await renderCard({ heroMetric: 'hrv', hrvData: [55, 57], rhrData: [48, 47] });
    expect(hrv.getByTestId('summary-card-hrv-sparkline')).toBeTruthy();
  });
});

describe('the HRV hero', () => {
  vaultIt('prints HRV and resting HR in primary ink, keyed by their series', async () => {
    const card = await renderCard({
      heroMetric: 'hrv',
      hrvData: [55, 58, 61],
      rhrData: [48, 47, 46],
    });

    expect(card.getByTestId('summary-card-hrv-value')).toHaveStyle({ color: colors.textPrimary });
    expect(card.getByTestId('summary-card-rhr-value')).toHaveStyle({ color: colors.textPrimary });
    expect(card.getByTestId('summary-card-key-hrv')).toHaveStyle({
      backgroundColor: colors.chartHrv,
    });
    expect(card.getByTestId('summary-card-key-rhr')).toHaveStyle({
      backgroundColor: colors.chartRhr,
    });
  });
});

describe('the form bar under the fitness sparkline', () => {
  it('draws each day in the zone the engine judged for it', async () => {
    mockFormBar.mockClear();

    await render(
      <SummaryCardSparkline
        fitnessData={[40, 100]}
        formData={[-8, -8]}
        formZoneData={['optimal', 'greyZone']}
        formTextData={['-20%', '-8%']}
        width={300}
      />
    );

    expect(mockFormBar).toHaveBeenLastCalledWith(['optimal', 'greyZone'], 300);
  });
});

describe('form on a half-unit day', () => {
  // What the engine answers for each day's loads: one rounded form, with its
  // zone and text, for the hero, the supporting row and the sparkline. The
  // card prints those and derives none of them.
  it.each([
    ['ctl 50.5, atl 40.4', { fitness: 51, fatigue: 40, form: 11 }],
    ['ctl 40.5, atl 30.5', { fitness: 41, fatigue: 31, form: 10 }],
  ])('prints one form for %s in the hero and the supporting row', async (_day, day) => {
    useDashboardPreferences.setState({
      summaryCard: { ...DEFAULTS, heroMetric: 'fitness', supportingMetrics: ['form'] },
    });
    const printed = `+${day.form}`;
    const card = summaryCardBundle({
      wellness: {
        fitness: day.fitness,
        form: day.form,
        formZone: 'fresh',
        formText: printed,
      },
    });
    const sparklines = {
      fitness: [day.fitness - 1, day.fitness],
      fatigue: [day.fatigue, day.fatigue],
      form: [day.fitness - 1 - day.fatigue, day.form],
      formZone: ['fresh', 'fresh'],
      formText: [`+${day.fitness - 1 - day.fatigue}`, printed],
      hrv: [],
      rhr: [],
      hrvRead: [],
      rhrRead: [],
    };
    const { result } = await renderHook(() =>
      useSummaryCardData(card, { awaitPrecomputed: true, precomputedSparklines: sparklines })
    );

    const tree = await renderCard(result.current);

    expect(tree.getByText(new RegExp(`^\\${printed} formZones\\.`))).toBeTruthy();
    expect(tree.getByTestId('summary-card-metric-0')).toHaveTextContent(`metrics.form${printed}`);
  });
});

describe('form as the engine states it for the athlete', () => {
  async function supportingForm(formText: string | undefined) {
    useDashboardPreferences.setState({
      summaryCard: { ...DEFAULTS, heroMetric: 'fitness', supportingMetrics: ['form'] },
    });
    const card = summaryCardBundle({
      wellness: { fitness: 40, form: -8, ...(formText === undefined ? {} : { formText }) },
    });
    const sparklines = {
      fitness: [40, 40],
      fatigue: [48, 48],
      form: [-8, -8],
      formZone: [undefined, undefined],
      formText: [undefined, undefined],
      hrv: [],
      rhr: [],
      hrvRead: [],
      rhrRead: [],
    };
    return (
      await renderHook(() =>
        useSummaryCardData(card, { awaitPrecomputed: true, precomputedSparklines: sparklines })
      )
    ).result.current.supportingMetrics[0].value;
  }

  it('prints the supporting form as the engine wrote it', async () => {
    expect(await supportingForm('-20%')).toBe('-20%');
    expect(await supportingForm('-8')).toBe('-8');
  });

  it('prints no number when the engine stated none', async () => {
    expect(await supportingForm(undefined)).toBe(ABSENT);
  });
});

describe('a tap on a supporting metric', () => {
  const EVERY: MetricId[] = ['fitness', 'ftp', 'weekHours', 'weekCount'];

  it.each(EVERY)('opens the chart %s summarises', async (metric) => {
    useDashboardPreferences.setState({ summaryCard: { ...DEFAULTS, supportingMetrics: [metric] } });
    const { result } = await renderHook(() => useSummaryCardData());
    const tree = await renderCard({ supportingMetrics: result.current.supportingMetrics });

    await fireEvent.press(tree.getByTestId('summary-card-metric-0'));

    expect(router.push).toHaveBeenLastCalledWith(summaryCardTarget(metric));
  });
});
