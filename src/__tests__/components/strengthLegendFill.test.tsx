/**
 * Scenario: the Strength body diagram keys its five volume steps with a legend
 * under the bodies. It was one continuous gradient from the untrained fill
 * through the ramp with only the two ends labelled, so it showed neither the
 * steps a muscle is drawn in nor where one gave way to the next.
 *
 * Expected behaviour: the legend is one untrained swatch in the colour an
 * untrained muscle is drawn in, then one swatch per volume step in that step's
 * colour, each step labelled with the most sets it covers, in either theme.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import { bodyDiagram } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

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
    BodyPairWithLoupe: ({ colors }: { colors: readonly string[] }) => (
      <View testID="bodies" accessibilityHint={colors.join(',')} />
    ),
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('expo-linear-gradient'),
    LinearGradient: () => <View testID="legend-gradient" />,
  };
});

async function draw(maxWeightedSets = 12) {
  await render(
    <StrengthBodyDiagram
      bodyData={[]}
      gender="male"
      maxWeightedSets={maxWeightedSets}
      selectedVolume={null}
      tappableSlugs={new Set()}
      onMuscleTap={() => {}}
      onMuscleScrub={() => {}}
      onClearSelection={() => {}}
    />
  );
  return screen
    .getAllByTestId(/^strength-legend-step-/)
    .map((node) => StyleSheet.flatten(node.props.style).backgroundColor as string);
}

describe.each([
  ['dark', true],
  ['light', false],
] as const)('the strength volume legend in the %s theme', (theme, isDark) => {
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws one untrained swatch and then one swatch per volume step', async () => {
    const swatches = await draw();

    expect(swatches).toEqual([bodyDiagram[theme].untrained, ...bodyDiagram[theme].steps]);
    expect(screen.getByTestId('bodies').props.accessibilityHint).toBe(
      bodyDiagram[theme].steps.join(',')
    );
  });

  it('draws no gradient', async () => {
    await draw();

    expect(screen.queryByTestId('legend-gradient')).toBeNull();
  });

  it('labels untrained with nought and each step with the most sets it covers', async () => {
    await draw(12);

    const labels = screen
      .getAllByTestId(/^strength-legend-label-/)
      .map((node) => node.props.children);
    expect(labels).toEqual(['0', '2.4', '4.8', '7.2', '9.6', '12']);
  });
});
