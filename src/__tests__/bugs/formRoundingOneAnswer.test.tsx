/**
 * Scenario: a wellness day whose loads sit either side of a half unit, so
 * rounding each load before subtracting and rounding the difference disagree.
 * The engine states the day's form once, from the rounded loads.
 *
 * Expected behaviour: the fitness tab, the activity Form card and the Today
 * banner each print the figure and zone the engine stated, so a card's Form
 * adds up from the Fitness and Fatigue beside it.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { TodayBanner } from '@/features/routes/components/TodayBanner';
import type { WellnessData } from '@/types';
import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: 'en-AU' }, t: (key: string) => key }),
}));
jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));
jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

const activity = activityRecord({
  id: 'a1',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
});

function fitnessTabReadout(day: WellnessData) {
  return render(<FitnessChart data={[day]} />);
}

async function activityFormCard(day: WellnessData) {
  const { result } = await renderHook(() =>
    useActivityStats({ activity, wellness: day, isMetric: true })
  );
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

async function todayBannerForm(text: string) {
  const tree = await render(<TodayBanner form={{ zone: 'fresh', text, asPercent: false }} />);
  const escaped = text.replace(/[+]/g, '\\+');
  return tree.queryByText(new RegExp(`activity\\.stats\\.formTSB ${escaped}$`));
}

describe.each([
  [50.5, 40.4, 51, 40, '+11'],
  [45.4, 50.6, 45, 51, '-6'],
  [60.5, 60.4, 61, 60, '+1'],
  [60.4, 60.4, 60, 60, '0'],
])('ctl %d and atl %d', (ctl, atl, fitness, fatigue, shown) => {
  const day = {
    id: '2026-09-05',
    ctl,
    atl,
    form: Number(shown),
    formZone: 'greyZone',
    formText: shown,
    tsbText: shown,
  } as WellnessData;

  it('the fitness tab shows the form the engine stated beside rounded loads', async () => {
    const tree = await fitnessTabReadout(day);
    expect(tree.getByTestId('fitness-form-value')).toHaveTextContent(shown, { exact: true });
    expect(tree.getByTestId('fitness-ctl-value')).toHaveTextContent(`${fitness}`, { exact: true });
    expect(tree.getByTestId('fitness-atl-value')).toHaveTextContent(`${fatigue}`, { exact: true });
  });

  it('the activity Form card agrees and lists the absolute TSB with its loads', async () => {
    const card = await activityFormCard(day);
    expect(card?.value).toBe(shown);
    const details = Object.fromEntries(card!.details!.map((d) => [d.label, d.value]));
    expect(details['activity.stats.formTSB']).toBe(shown);
    expect(details['activity.stats.fitnessCTL']).toBe(`${fitness}`);
    expect(details['activity.stats.fatigueATL']).toBe(`${fatigue}`);
  });

  it('the Today banner agrees', async () => {
    expect(await todayBannerForm(shown)).not.toBeNull();
  });
});

describe.each([
  ['fresh', '+5', 'Fresh'],
  ['greyZone', '-10', 'Grey zone'],
  ['optimal', '-30', 'Optimal'],
] as const)('the engine states %s', (zone, shown, zoneLabel) => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('the Today banner names that zone beside the form it prints', async () => {
    const tree = await render(<TodayBanner form={{ zone, text: shown, asPercent: false }} />);
    const escaped = shown.replace(/[+]/g, '\\+');
    expect(
      tree.getByText(new RegExp(`^${zoneLabel} \u00B7 activity\\.stats\\.formTSB ${escaped}$`))
    ).toBeTruthy();
  });
});
