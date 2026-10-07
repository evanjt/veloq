/**
 * Scenario: the insight list, activity stats, fitness chart and strength
 * progression each drew their own container.
 *
 * Expected behaviour: all four are the `Card` on the dark card surface and the
 * shared radius, none carries a margin, and a stat tile sits one step below
 * the card it is in.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { InsightListCard } from '@/features/insights/components/InsightListCard';
import { InsightfulStats } from '@/features/activity/components/stats/InsightfulStats';
import { StatCard } from '@/features/activity/components/stats/StatCard';
import { FitnessChartCard } from '@/features/fitness/components/sections/FitnessChartCard';
import { StrengthProgressionCard } from '@/features/strength/components/StrengthProgressionCard';
import { Card } from '@/shared/ui/Card';
import { darkColors, layout } from '@/theme';
import type { Activity, Insight, MuscleVolume } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/fitness/components', () => ({
  FitnessChart: () => null,
  FormZoneChart: () => null,
  ActivityDotsChart: () => null,
}));

type Rendered = ReturnType<typeof render>;

const style = (node: { props: { style?: unknown } }): Record<string, unknown> => {
  const raw = node.props.style;
  const resolved = typeof raw === 'function' ? raw({ pressed: false }) : raw;
  return (StyleSheet.flatten(resolved as never) as Record<string, unknown>) ?? {};
};

function expectDarkCard(view: Rendered) {
  const card = view.UNSAFE_getAllByType(Card)[0];
  expect(card).toBeTruthy();
  const host = view.UNSAFE_getAllByType(Card)[0].children[0] as unknown as {
    props: { style?: unknown };
  };
  const ground = style(host);
  expect(ground.backgroundColor).toBe(darkColors.surfaceCard);
  expect(ground.borderRadius).toBe(layout.borderRadius);
  expect(ground.margin).toBeUndefined();
  expect(ground.marginHorizontal).toBeUndefined();
  expect(ground.marginTop).toBeUndefined();
  expect(ground.marginBottom).toBeUndefined();
}

const insight = {
  id: 'i1',
  category: 'fitness_milestone',
  title: 'A record',
  icon: 'trophy',
  iconTone: 'neutral',
} as unknown as Insight;

const ride = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  average_heartrate: 150,
} as Activity;

const volume = {
  slug: 'chest',
  primarySets: 4,
  secondarySets: 0,
  weightedSets: 4,
  totalReps: 40,
  totalWeightKg: 1000,
  exerciseNames: [],
} as unknown as MuscleVolume;

describe('cards off the home scroll', () => {
  it('draws an insight entry on the dark card', () => {
    expectDarkCard(render(<InsightListCard insight={insight} onPress={jest.fn()} />));
  });

  it('draws the activity stats on the dark card', () => {
    expectDarkCard(render(<InsightfulStats activity={ride} />));
  });

  it('draws the fitness chart on the dark card', () => {
    expectDarkCard(
      render(
        <FitnessChartCard
          wellness={[]}
          activities={[]}
          dailyLoads={[]}
          eftpChanges={[]}
          selectedDate={null}
          sharedSelectedIdx={{ value: -1 } as never}
          onDateSelect={jest.fn()}
          onInteractionChange={jest.fn()}
        />
      )
    );
  });

  it('draws the strength progression on the dark card', () => {
    expectDarkCard(
      render(
        <StrengthProgressionCard
          selectedVolume={volume}
          progression={null}
          maxProgressWeightedSets={6}
        />
      )
    );
  });

  it('keeps a stat tile off its card ground', () => {
    const stats = render(<InsightfulStats activity={ride} />);
    const cardGround = style(stats.UNSAFE_getAllByType(Card)[0].children[0] as never);
    const tile = render(
      <StatCard
        stat={{ title: 'T', value: '1', icon: 'heart', color: '#000' } as never}
        isDark
        onPress={jest.fn()}
      />
    );
    const tileGround = style(tile.toJSON() as never);
    expect(tileGround.backgroundColor).toBeDefined();
    expect(tileGround.backgroundColor).not.toBe(cardGround.backgroundColor);
  });
});
