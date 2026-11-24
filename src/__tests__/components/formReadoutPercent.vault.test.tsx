/**
 * Scenario: the fitness chart's corner prints the Form number the engine
 * stated, which is a percentage of fitness under the percentage preference.
 *
 * Expected behaviour: the corner prints the engine's text as it was stated, a
 * day the engine states no form for prints no number. The
 * form chart with no days says so under its title rather than drawing nothing.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { ABSENT } from '@/shared/format/absent';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ colors: { textSecondary: '#888', text: '#000' } }),
}));

async function cornerForm(day: Record<string, unknown>) {
  await render(<FitnessChart data={[{ id: '2026-09-12', ...day }] as never} />);
  return screen.getByTestId('fitness-form-value');
}

describe('the fitness chart corner form', () => {
  it('prints a signed percentage of fitness', async () => {
    expect(
      await cornerForm({ ctl: 40, atl: 48, formZone: 'optimal', formText: '-20%' })
    ).toHaveTextContent('-20%', { exact: true });
  });

  it('prints no number when fitness is zero', async () => {
    expect(await cornerForm({ ctl: 0, atl: 8 })).toHaveTextContent(ABSENT, { exact: true });
  });

  it('prints the absolute number when the engine stated that', async () => {
    expect(
      await cornerForm({ ctl: 40, atl: 48, formZone: 'greyZone', formText: '-8' })
    ).toHaveTextContent('-8', { exact: true });
  });
});

describe('the form chart with no days', () => {
  it('draws the shared inline empty state', () => {
    render(<FormZoneChart data={[]} />);
    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('fitness.noData');
    expect(screen.queryByTestId('empty-state-icon')).toBeNull();
  });
});
