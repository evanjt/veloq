/**
 * Scenario: on a Garmin source Veloq works out the training load, and fitness,
 * fatigue and form follow from it.
 *
 * Expected behaviour: the definitions card states that method on a Garmin
 * source and not on an intervals.icu one.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { FitnessDefinitionsCard } from '@/features/fitness/components/sections/FitnessDefinitionsCard';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

afterEach(() => {
  act(() => useAuthStore.setState({ authMethod: null }));
});

describe('the fitness definitions card', () => {
  it('states that Veloq works out the load on a Garmin source', async () => {
    act(() => useAuthStore.setState({ authMethod: 'garmin' }));
    await render(<FitnessDefinitionsCard fitnessDays={42} fatigueDays={7} />);

    expect(screen.getByText('fitnessScreen.methodGarmin')).toBeTruthy();
  });

  it('says nothing of it on an intervals.icu source', async () => {
    act(() => useAuthStore.setState({ authMethod: 'oauth' }));
    await render(<FitnessDefinitionsCard fitnessDays={42} fatigueDays={7} />);

    expect(screen.queryByText('fitnessScreen.methodGarmin')).toBeNull();
  });
});
