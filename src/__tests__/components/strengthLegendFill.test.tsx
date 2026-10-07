/**
 * Scenario: the Strength body diagram in the dark theme. Untrained muscles are
 * drawn in the dark untrained fill, and the volume legend under the bodies
 * started from the light one whatever the theme.
 *
 * Expected behaviour: the legend's zero is the colour an untrained muscle is
 * drawn in, in either theme.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import { bodyDiagram } from '@/theme/colors';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/theme', () => {
  const real = jest.requireActual('@/theme/colors');
  return {
    ...jest.requireActual('@/theme'),
    bodyDiagram: real.bodyDiagram,
    strengthRamp: real.strengthRamp,
  };
});

let mockIsDark = true;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { View } = require('react-native');
  return {
    BodyPairWithLoupe: ({ defaultFill }: { defaultFill: string }) => (
      <View testID="bodies" accessibilityHint={defaultFill} />
    ),
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('expo-linear-gradient'),
    LinearGradient: ({ colors }: { colors: string[] }) => (
      <View testID="legend" accessibilityHint={colors[0]} />
    ),
  };
});

function draw() {
  render(
    <StrengthBodyDiagram
      bodyData={[]}
      gender="male"
      maxWeightedSets={12}
      selectedVolume={null}
      tappableSlugs={new Set()}
      onMuscleTap={() => {}}
      onMuscleScrub={() => {}}
      onClearSelection={() => {}}
    />
  );
  return {
    untrained: screen.getByTestId('bodies').props.accessibilityHint,
    legendZero: screen.getByTestId('legend').props.accessibilityHint,
  };
}

describe('the strength volume legend', () => {
  it('starts from the dark untrained fill in the dark theme', () => {
    mockIsDark = true;
    const { untrained, legendZero } = draw();

    expect(untrained).toBe(bodyDiagram.fillDark);
    expect(legendZero).toBe(untrained);
  });

  it('starts from the light untrained fill in the light theme', () => {
    mockIsDark = false;
    const { untrained, legendZero } = draw();

    expect(untrained).toBe(bodyDiagram.fillLight);
    expect(legendZero).toBe(untrained);
  });
});
