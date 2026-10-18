import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { StrengthBalanceScale } from '@/features/strength/components/StrengthBalanceScale';
import { StrengthProgressionCard } from '@/features/strength/components/StrengthProgressionCard';
import { colourTokens } from '@/theme';
import type { MuscleVolume, StrengthProgression } from '@/types';

let mockIsDark = false;
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
  useMetricSystem: () => true,
}));

const volume = {
  slug: 'chest',
  primarySets: 4,
  secondarySets: 0,
  weightedSets: 4,
  totalReps: 40,
  totalWeightKg: 1000,
  exerciseNames: [],
} as unknown as MuscleVolume;

const fourWeeks = {
  muscleSlug: 'chest',
  trend: 'up',
  changePct: 20,
  recentAverage: 5,
  baselineAverage: 4,
  peakWeightedSets: 6,
  points: [
    { label: 'w1', weightedSets: 2 },
    { label: 'w2', weightedSets: 3 },
    { label: 'w3', weightedSets: 4 },
    { label: 'w4', weightedSets: 6 },
  ],
} as unknown as StrengthProgression;

function fill(node: { props: { style?: unknown } }): unknown {
  return StyleSheet.flatten(node.props.style as never)?.backgroundColor;
}

describe.each([
  ['light', false],
  ['dark', true],
] as const)('in the %s theme', (theme, isDark) => {
  const tokens = colourTokens[theme];
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws the two sides of a balance in the forward and reverse direction colours', async () => {
    await render(<StrengthBalanceScale leftWeightedSets={6} rightWeightedSets={3} />);
    const sides = screen.getByTestId('strength-balance-scale').children as {
      props: { style?: unknown };
    }[];
    expect(fill(sides[0])).toBe(tokens['direction-forward']);
    expect(fill(sides[2])).toBe(tokens['direction-reverse']);
  });

  it('draws the current week in the series colour and earlier weeks muted', async () => {
    await render(
      <StrengthProgressionCard
        selectedVolume={volume}
        progression={fourWeeks}
        maxProgressWeightedSets={6}
      />
    );
    const bars = screen
      .UNSAFE_getAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style)?.width === 6);
    expect(bars.map(fill)).toEqual([
      tokens['chart-muted'],
      tokens['chart-muted'],
      tokens['chart-muted'],
      tokens['chart-series'],
    ]);
  });
});
