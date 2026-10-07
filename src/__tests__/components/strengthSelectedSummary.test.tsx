/**
 * Scenario: a muscle is selected on the Strength body diagram.
 * Expected behaviour: the name row carries the muscle's weighted sets and
 * total volume in the athlete's unit; with no selection the row is absent.
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
    strengthRamp: real.strengthRamp,
  };
});

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let mockIsMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockIsMetric }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
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
};

function draw(selectedVolume: MuscleVolume | null) {
  render(
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

  it('shows weighted sets and volume beside the name', () => {
    draw(volume);
    expect(screen.getByTestId('strength-selected-summary').props.children).toBe(
      '· 12.5 strength.sets · 3420 kg'
    );
  });

  it('uses the athlete weight unit', () => {
    mockIsMetric = false;
    draw(volume);
    expect(screen.getByTestId('strength-selected-summary').props.children).toBe(
      '· 12.5 strength.sets · 7540 lbs'
    );
  });

  it('shows nothing without a selection', () => {
    draw(null);
    expect(screen.queryByTestId('strength-selected-summary')).toBeNull();
  });
});
