/**
 * Scenario: a screen reader user wants a muscle's sets and volume. They were
 * reachable only by a tap or a drag on the drawing, at coordinates.
 * Expected behaviour: the body pair is one adjustable element that steps
 * through the trained muscles in the order the read gave them, names the one
 * selected with its sets and volume, and never steps off the end.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import type { MuscleVolume } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/theme', () => {
  const real = jest.requireActual('@/theme/colors');
  return {
    ...jest.requireActual('@/theme'),
    bodyDiagram: real.bodyDiagram,
    strengthRamp: real.strengthRamp,
    loupeChrome: real.loupeChrome,
  };
});
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count == null ? key : `${options.count} ${key}`,
  }),
}));
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-linear-gradient', () => ({
  ...jest.requireActual('expo-linear-gradient'),
  LinearGradient: () => null,
}));

const abs: MuscleVolume = {
  slug: 'abs',
  primarySets: 10,
  secondarySets: 5,
  weightedSets: 12.5,
  totalReps: 100,
  volumeKg: 3420,
  exerciseNames: [],
  shade: 5,
};

function draw(selectedVolume: MuscleVolume | null, onMuscleTap = jest.fn()) {
  render(
    <StrengthBodyDiagram
      bodyData={[]}
      gender="male"
      maxWeightedSets={12}
      selectedVolume={selectedVolume}
      tappableSlugs={new Set(['chest', 'abs', 'quadriceps'])}
      onMuscleTap={onMuscleTap}
      onMuscleScrub={jest.fn()}
      onClearSelection={jest.fn()}
    />
  );
  const body = screen.getByRole('adjustable');
  const step = (name: 'increment' | 'decrement') =>
    fireEvent(body, 'accessibilityAction', { nativeEvent: { actionName: name } });
  return { body, step, onMuscleTap };
}

describe('the muscle diagram for a screen reader', () => {
  it('selects the first trained muscle on an increment', () => {
    const { step, onMuscleTap } = draw(null);

    step('increment');
    expect(onMuscleTap).toHaveBeenCalledWith('chest');
  });

  it('steps either way from the selected muscle and names it with its sets and volume', () => {
    const { body, step, onMuscleTap } = draw(abs);

    expect(body.props.accessibilityLabel).toBe('strength.muscleGroupVolume');
    expect(body.props.accessibilityValue.text).toContain('12.5 strength.setsCount');
    expect(body.props.accessibilityValue.text).toContain('3,420 kg');
    step('increment');
    expect(onMuscleTap).toHaveBeenLastCalledWith('quadriceps');
    step('decrement');
    expect(onMuscleTap).toHaveBeenLastCalledWith('chest');
  });

  it('holds at either end rather than clearing the selection', () => {
    const last = { ...abs, slug: 'quadriceps' };
    const { step, onMuscleTap } = draw(last);

    step('increment');
    expect(onMuscleTap).not.toHaveBeenCalled();
  });
});
