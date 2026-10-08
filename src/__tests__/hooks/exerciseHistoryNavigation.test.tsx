import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StrengthExerciseList } from '@/features/strength/components/StrengthExerciseList';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('opens the selected exercise history from the strength list', () => {
  render(
    <StrengthExerciseList
      selectedVolume={{
        slug: 'hamstring',
        primarySets: 12,
        secondarySets: 0,
        weightedSets: 12,
        totalReps: 96,
        volumeKg: 0,
        exerciseNames: ['Leg Curl'],
        shade: 5,
      }}
      exerciseSummary={{
        exercises: [
          {
            exerciseName: 'Leg Curl',
            exerciseCategory: 15,
            totalSets: 12,
            totalReps: 96,
            volumeKg: 0,
            activityCount: 2,
            isPrimary: true,
          },
        ],
      }}
    />
  );

  fireEvent.press(screen.getByTestId('exercise-history-15'));
  expect(mockRouterPush).toHaveBeenCalledWith('/exercise/15');
});
