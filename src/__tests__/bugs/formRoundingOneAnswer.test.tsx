/**
 * Scenario: a wellness day whose loads sit either side of a half unit, so
 * rounding each load before subtracting and rounding the difference disagree.
 * The fitness tab rounded each load, while the activity Form card and the
 * Today banner rounded the difference.
 *
 * Expected behaviour: every surface prints rounded fitness minus rounded
 * fatigue, so a card's Form adds up from the Fitness and Fatigue beside it.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { useFitnessComputations } from '@/features/fitness/hooks/useFitnessComputations';
import { TodayBanner } from '@/features/routes/components/TodayBanner';
import type { Activity, WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-AU' }, t: (key: string) => key }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({ todayWorkout: null, tomorrowWorkout: null, isLoading: false }),
}));
jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));

let mockWellnessDay: WellnessData;
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [mockWellnessDay] }),
  useWellnessLatestDate: () => ({ data: mockWellnessDay.id }),
}));

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
} as Activity;

function fitnessTabForm(day: WellnessData) {
  const { result } = renderHook(() =>
    useFitnessComputations({
      wellness: [day],
      sportMode: 'Cycling',
      powerZones: undefined,
      hrZones: undefined,
      eftpHistory: undefined,
      decouplingStreams: undefined,
      selectedDate: null,
      selectedValues: null,
    })
  );
  return result.current.currentValues?.form;
}

function activityFormCard(day: WellnessData) {
  const { result } = renderHook(() => useActivityStats({ activity, wellness: day }));
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

function todayBannerForm(day: WellnessData, shown: string) {
  mockWellnessDay = day;
  const tree = render(<TodayBanner todayPattern={null} />);
  const escaped = shown.replace(/[+]/g, '\\+');
  return tree.queryByText(new RegExp(`\\(${escaped} TSB\\)$`));
}

describe.each([
  [50.5, 40.4, 51, 40, '+11'],
  [45.4, 50.6, 45, 51, '-6'],
  [60.5, 60.4, 61, 60, '+1'],
  [60.4, 60.4, 60, 60, '0'],
])('ctl %d and atl %d', (ctl, atl, fitness, fatigue, shown) => {
  const day = { id: '2026-09-05', ctl, atl } as WellnessData;
  const form = fitness - fatigue;

  it('the fitness tab shows rounded fitness minus rounded fatigue', () => {
    expect(fitnessTabForm(day)).toBe(form);
  });

  it('the activity Form card agrees and adds up from its own details', () => {
    const card = activityFormCard(day);
    expect(card?.value).toBe(shown);
    const details = Object.fromEntries(card!.details!.map((d) => [d.label, d.value]));
    expect(details['activity.stats.formTSB']).toBe(shown);
    expect(details['activity.stats.fitnessCTL']).toBe(`${fitness}`);
    expect(details['activity.stats.fatigueATL']).toBe(`${fatigue}`);
  });

  it('the Today banner agrees', () => {
    expect(todayBannerForm(day, shown)).not.toBeNull();
  });
});
