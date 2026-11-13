import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { StrengthProgressionCard } from '@/features/strength/components/StrengthProgressionCard';
import type { ReactTestInstance } from 'react-test-renderer';
import { badgePaint } from '@/shared/ui/Badge';
import type { MuscleVolume, StrengthProgression } from '@/types';

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
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

function progression(trend: 'up' | 'down', changePct: number): StrengthProgression {
  return {
    muscleSlug: 'chest',
    trend,
    changePct,
    recentAverage: 5,
    baselineAverage: 2,
    peakWeightedSets: 6,
    points: [{ label: 'w1', weightedSets: 2 }],
  } as unknown as StrengthProgression;
}

/** The fill of the closest view behind a text, which is the badge it sits on. */
function badgeFill(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    const fill = StyleSheet.flatten(at.props.style ?? {}).backgroundColor;
    if (typeof fill === 'string') return fill;
  }
  return undefined;
}

it.each([
  ['up', 120],
  ['down', -80],
] as const)('colours a %s change badge on the neutral rung', async (trend, changePct) => {
  await render(
    <StrengthProgressionCard
      selectedVolume={volume}
      progression={progression(trend, changePct)}
      maxProgressWeightedSets={6}
    />
  );
  const text = screen.getByText(`${changePct > 0 ? '+' : ''}${changePct}%`);
  expect(badgeFill(text)).toBe(badgePaint('neutral', false).fill);
  expect(StyleSheet.flatten(text.props.style).color).toBe(badgePaint('neutral', false).ink);
});
