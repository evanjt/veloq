/**
 * Scenario: the fitness chart's corner and the form chart print one Form number
 * under the percentage preference.
 *
 * Expected behaviour: -8 against fitness 40 reads -20% on both, a day with no
 * fitness prints no number, and the preference off restores the absolute value.
 * The form chart with no days says so under its title rather than drawing
 * nothing.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { ABSENT } from '@/shared/format/absent';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ colors: { textSecondary: '#888', text: '#000' } }),
}));

afterEach(() => useFormPreference.setState({ formAsPercent: null }));

async function cornerForm(fitness: number, form: number) {
  await render(
    <FitnessChart data={[{ id: '2026-09-12', ctl: fitness, atl: fitness - form }] as never} />
  );
  return screen.getByTestId('fitness-form-value');
}

describe('the fitness chart corner form', () => {
  it('prints a signed percentage of fitness', async () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(await cornerForm(40, -8)).toHaveTextContent('-20%', { exact: true });
  });

  it('prints no number when fitness is zero', async () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(await cornerForm(0, -8)).toHaveTextContent(ABSENT, { exact: true });
  });

  it('prints the absolute number with the preference off', async () => {
    useFormPreference.setState({ formAsPercent: false });
    expect(await cornerForm(40, -8)).toHaveTextContent('-8', { exact: true });
  });
});

describe('the form chart value', () => {
  const day = (fitness: number, form: number) => [
    { id: '2026-09-12', ctl: fitness, atl: fitness - form },
  ];

  it('suffixes the percentage', async () => {
    useFormPreference.setState({ formAsPercent: true });
    await render(<FormZoneChart data={day(40, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent('-20%');
  });

  it('prints the absent mark with no fitness', async () => {
    useFormPreference.setState({ formAsPercent: true });
    await render(<FormZoneChart data={day(0, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent(ABSENT);
    expect(screen.getByTestId('form-chart-value')).not.toHaveTextContent('%');
  });

  it('prints the absolute value with the preference off', async () => {
    useFormPreference.setState({ formAsPercent: false });
    await render(<FormZoneChart data={day(40, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent('-8');
  });
});

describe('the form chart with no days', () => {
  it('draws the shared inline empty state', () => {
    render(<FormZoneChart data={[]} />);
    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('fitness.noData');
    expect(screen.queryByTestId('empty-state-icon')).toBeNull();
  });
});
