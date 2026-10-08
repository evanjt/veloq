/**
 * Scenario: the fitness chart's corner and the form chart print one Form number
 * under the percentage preference.
 *
 * Expected behaviour: -8 against fitness 40 reads -20% on both, a day with no
 * fitness prints no number, and the preference off restores the absolute value.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ colors: { textSecondary: '#888', text: '#000' } }),
}));

afterEach(() => useFormPreference.setState({ formAsPercent: null }));

function cornerForm(fitness: number, form: number) {
  render(
    <FitnessChart data={[{ id: '2026-09-12', ctl: fitness, atl: fitness - form }] as never} />
  );
  return screen.getByTestId('fitness-form-value');
}

describe('the fitness chart corner form', () => {
  it('prints a signed percentage of fitness', () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(cornerForm(40, -8)).toHaveTextContent('-20%', { exact: true });
  });

  it('prints no number when fitness is zero', () => {
    useFormPreference.setState({ formAsPercent: true });
    expect(cornerForm(0, -8)).toHaveTextContent('-', { exact: true });
  });

  it('prints the absolute number with the preference off', () => {
    useFormPreference.setState({ formAsPercent: false });
    expect(cornerForm(40, -8)).toHaveTextContent('-8', { exact: true });
  });
});

describe('the form chart value', () => {
  const day = (fitness: number, form: number) => [
    { id: '2026-09-12', ctl: fitness, atl: fitness - form },
  ];

  it('suffixes the percentage', () => {
    useFormPreference.setState({ formAsPercent: true });
    render(<FormZoneChart data={day(40, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent('-20%');
  });

  it('prints a dash with no fitness', () => {
    useFormPreference.setState({ formAsPercent: true });
    render(<FormZoneChart data={day(0, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent('-');
    expect(screen.getByTestId('form-chart-value')).not.toHaveTextContent('%');
  });

  it('prints the absolute value with the preference off', () => {
    useFormPreference.setState({ formAsPercent: false });
    render(<FormZoneChart data={day(40, -8) as never} />);
    expect(screen.getByTestId('form-chart-value')).toHaveTextContent('-8');
  });
});
