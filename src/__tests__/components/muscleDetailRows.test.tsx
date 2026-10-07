/**
 * Scenario: the muscle detail on a strength activity. The engine reports each
 * exercise's set count and its total repetitions across those sets, and the row
 * printed them as `sets×reps`, which a lifter reads as sets of that many reps:
 * three sets of five read as 3×15.
 *
 * Expected behaviour: each row says what the figures are, a set count and a
 * repetition total, through the same keys as the totals above them.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { MuscleGroupView } from '@/features/strength/components/MuscleGroupView';
import type { ActivityDetail } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { View } = require('react-native');
  return {
    BodyPairWithLoupe: ({ centerContent }: { centerContent: React.ReactNode }) => (
      <View>{centerContent}</View>
    ),
  };
});

jest.mock('@/features/strength/hooks/useExerciseSets', () => ({
  useMuscleGroups: () => ({ data: [{ slug: 'chest', intensity: 2 }] }),
}));

// Bench press as 3 sets of 5 and a fly as 5 sets of 5, the engine's totals.
jest.mock('@/features/strength/hooks/useMuscleDetail', () => ({
  useMuscleDetail: () => ({
    name: 'Chest',
    slug: 'chest',
    exercises: [
      { name: 'Bench Press', role: 'primary', sets: 3, reps: 15, volumeKg: 900 },
      { name: 'Flye', role: 'primary', sets: 5, reps: 25, volumeKg: 500 },
    ],
    totalSets: 8,
    totalReps: 40,
    volumeKg: 1400,
    primaryExercises: 2,
    secondaryExercises: 0,
  }),
}));

const counts = (sets: number, reps: number) =>
  `activity.muscle.setCount:{"count":${sets}} · activity.muscle.repsCount:{"count":${reps}}`;

describe('the muscle detail rows', () => {
  it('give each exercise its set count and its repetition total', () => {
    render(
      <MuscleGroupView
        activityId="demo-test-6"
        activity={{ id: 'demo-test-6' } as unknown as ActivityDetail}
        hasExercises
        isDark={false}
      />
    );

    expect(screen.getByText(counts(3, 15))).toBeTruthy();
    expect(screen.getByText(counts(5, 25))).toBeTruthy();
    expect(screen.queryByText('3×15')).toBeNull();
    expect(screen.queryByText('5×25')).toBeNull();
  });
});
