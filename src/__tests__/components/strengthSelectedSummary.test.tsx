/**
 * Scenario: a muscle is selected on the Strength body diagram.
 * Expected behaviour: the name row carries the muscle's weighted sets and
 * total volume in the athlete's unit, and a screen reader hears that pressing
 * it clears the muscle; with no selection the row is absent.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import type { MuscleVolume } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/theme', () => {
  const real = jest.requireActual('@/theme/colors');
  return {
    ...jest.requireActual('@/theme'),
    bodyDiagram: real.bodyDiagram,
    sequentialRamp: real.sequentialRamp,
  };
});

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let mockIsMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockIsMetric }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; muscle?: string }) =>
      options?.muscle != null
        ? `${key}(${options.muscle})`
        : options?.count == null
          ? key
          : `${options.count} ${key}`,
  }),
}));

jest.mock('@/features/strength/components/BodyPairWithLoupe', () => ({
  BodyPairWithLoupe: () => null,
}));

jest.mock('expo-linear-gradient', () => ({
  ...jest.requireActual('expo-linear-gradient'),
  LinearGradient: () => null,
}));

const volume: MuscleVolume = {
  slug: 'abs',
  primarySets: 10,
  secondarySets: 5,
  weightedSets: 12.5,
  totalReps: 100,
  volumeKg: 3420,
  exerciseNames: [],
  shade: 5,
};

async function draw(selectedVolume: MuscleVolume | null) {
  await render(
    <StrengthBodyDiagram
      bodyData={[]}
      gender="male"
      maxWeightedSets={12}
      selectedVolume={selectedVolume}
      tappableSlugs={new Set()}
      onMuscleTap={() => {}}
      onMuscleScrub={() => {}}
      onClearSelection={() => {}}
    />
  );
}

describe('selected muscle summary', () => {
  beforeEach(() => {
    mockIsMetric = true;
  });

  it('shows weighted sets and volume beside the name', async () => {
    await draw(volume);
    expect(screen.getByTestId('strength-selected-summary').props.children).toBe(
      '· 12.5 strength.setsCount · 3,420 kg'
    );
  });

  it('uses the athlete weight unit', async () => {
    mockIsMetric = false;
    await draw(volume);
    expect(screen.getByTestId('strength-selected-summary').props.children).toBe(
      '· 12.5 strength.setsCount · 7,540 lbs'
    );
  });

  it('names the row as clearing the selected muscle, with its numbers', async () => {
    await draw(volume);
    expect(
      screen.getByRole('button', {
        name: 'strength.clearMuscle(strength.muscles.abs), 12.5 strength.setsCount · 3,420 kg',
      })
    ).toBeTruthy();
  });

  it('shows nothing without a selection', async () => {
    await draw(null);
    expect(screen.queryByTestId('strength-selected-summary')).toBeNull();
  });
});
