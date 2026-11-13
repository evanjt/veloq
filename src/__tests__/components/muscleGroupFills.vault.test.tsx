/**
 * Scenario: a strength activity's muscle view draws primary and assisting
 * muscles on the body pair and keys them with two dots. They were drawn in a
 * fixed pair of hues the rest of the app no longer uses, the same in both
 * themes.
 *
 * Expected behaviour: a primary muscle takes the top sequential step and an
 * assisting one the middle step, on the body and in the key, in the theme drawn.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { MuscleGroupView } from '@/features/strength/components/MuscleGroupView';
import { colourTokens } from '@/theme';

import { activityRecord } from '../__shared__/activityRecord';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/strength/components/BodyPairWithLoupe', () => {
  const { View } = require('react-native');
  return {
    BodyPairWithLoupe: ({
      colors,
      centerContent,
    }: {
      colors: readonly string[];
      centerContent: React.ReactNode;
    }) => (
      <View testID="bodies" accessibilityHint={colors.join(',')}>
        {centerContent}
      </View>
    ),
  };
});

jest.mock('@/features/strength/hooks/useExerciseSets', () => ({
  useMuscleGroups: () => ({ data: [{ slug: 'chest', intensity: 2 }] }),
}));

jest.mock('@/features/strength/hooks/useMuscleDetail', () => ({
  useMuscleDetail: () => null,
}));

describe.each([
  ['light', false],
  ['dark', true],
] as const)('the muscle view in the %s theme', (theme, isDark) => {
  const token = colourTokens[theme];

  it('draws assisting then primary muscles on the middle and top sequential steps', async () => {
    await render(
      <MuscleGroupView
        activityId="demo-test-6"
        activity={activityRecord({ id: 'demo-test-6' })}
        hasExercises
        isDark={isDark}
      />
    );

    expect(screen.getByTestId('bodies').props.accessibilityHint).toBe(
      `${token['data-seq-3']},${token['data-seq-5']}`
    );
    const keyed = screen
      .getByTestId('bodies')
      .findAll((node) => typeof node.type === 'string')
      .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor)
      .filter(Boolean);
    expect(keyed).toEqual(expect.arrayContaining([token['data-seq-5'], token['data-seq-3']]));
  });
});
