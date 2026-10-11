/**
 * Scenario: one screen carries several info buttons, and a screen reader lists
 * controls by name.
 *
 * Expected behaviour: each button is named after the topic it explains, so two
 * buttons on one screen never share a name.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { changeLanguage, initialiseI18n } from '@/i18n';
import { InfoButton } from '@/features/settings/components/InfoButton';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

describe('InfoButton', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
    await changeLanguage('en-GB');
  });

  it('names each button after the topic it explains', () => {
    render(
      <>
        <InfoButton testID="info-tides" title="Tide tables" message="When the water turns." />
        <InfoButton testID="info-knots" title="Knots" message="Which loop holds." />
      </>
    );

    const tides = screen.getByTestId('info-tides').props.accessibilityLabel as string;
    const knots = screen.getByTestId('info-knots').props.accessibilityLabel as string;
    expect(tides).toContain('Tide tables');
    expect(knots).toContain('Knots');
    expect(tides).not.toBe(knots);
    expect(screen.getByRole('button', { name: tides })).toBeTruthy();
  });
});
