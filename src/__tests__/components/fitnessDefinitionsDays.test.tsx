/**
 * Scenario: an athlete who set their fitness and fatigue to 28 and 5 days read
 * on the Fitness tab that fitness is a 42-day and fatigue a 7-day average.
 *
 * Expected behaviour: the definitions state the days the screen read carries,
 * and leave fitness and fatigue undefined rather than guess when the read has
 * none to give.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { FitnessDefinitionsCard } from '@/features/fitness/components/sections/FitnessDefinitionsCard';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

describe('the fitness definitions', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('states the fitness and fatigue days the athlete set', async () => {
    const { queryByText } = await render(
      <FitnessDefinitionsCard fitnessDays={28} fatigueDays={5} />
    );

    expect(queryByText(/a 28-day exponentially weighted/)).toBeTruthy();
    expect(queryByText(/a 5-day exponentially weighted/)).toBeTruthy();
    expect(queryByText(/42-day/)).toBeNull();
    expect(queryByText(/7-day/)).toBeNull();
  });

  it('states the default days when those are the ones in effect', async () => {
    const { queryByText } = await render(
      <FitnessDefinitionsCard fitnessDays={42} fatigueDays={7} />
    );

    expect(queryByText(/a 42-day exponentially weighted/)).toBeTruthy();
    expect(queryByText(/a 7-day exponentially weighted/)).toBeTruthy();
  });

  it('states no days when the read gave none', async () => {
    const { queryByText } = await render(
      <FitnessDefinitionsCard fitnessDays={null} fatigueDays={null} />
    );

    expect(queryByText(/exponentially weighted/)).toBeNull();
    expect(queryByText(/\{\{/)).toBeNull();
    expect(queryByText(/fitness minus fatigue/)).toBeTruthy();
  });
});
