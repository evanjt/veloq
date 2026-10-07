/**
 * Scenario: the fitness header and the form chart print one Form number under
 * the percentage preference.
 *
 * Expected behaviour: -8 against fitness 40 reads -20% on both, a day with no
 * fitness prints no number, and the preference off restores the absolute value.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { FitnessHeaderStats } from '@/features/fitness/components/FitnessHeaderStats';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ colors: { textSecondary: '#888', text: '#000' } }),
}));

afterEach(() => useFormPreference.setState({ formAsPercent: null }));

function header(fitness: number, form: number) {
  render(
    <FitnessHeaderStats
      displayDate="2026-09-12"
      displayValues={{ fitness, fatigue: fitness - form, form }}
      formZone={null}
      isDark={false}
      rampRate={null}
    />
  );
}

describe('the fitness header form', () => {
  it('prints a signed percentage of fitness', () => {
    useFormPreference.setState({ formAsPercent: true });
    header(40, -8);
    expect(screen.getByText('-20%')).toBeTruthy();
  });

  it('prints no number when fitness is zero', () => {
    useFormPreference.setState({ formAsPercent: true });
    header(0, -8);
    expect(screen.queryByText('-8')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('prints the absolute number with the preference off', () => {
    useFormPreference.setState({ formAsPercent: false });
    header(40, -8);
    expect(screen.getByText('-8')).toBeTruthy();
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
