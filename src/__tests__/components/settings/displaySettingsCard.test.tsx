/**
 * Scenario: the Display spoke shows appearance, units, language and the primary sport.
 * Expected behaviour: one section card holds the theme picker and the sport picker, and the
 * sport hint renders inside it.
 */

import React from 'react';
import { View } from 'react-native';
import { render, within } from '@testing-library/react-native';

import { DisplaySettings } from '@/features/settings/components/DisplaySettings';
import { settingsStyles } from '@/features/settings/components/settingsStyles';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

function renderDisplay() {
  return render(
    <DisplaySettings
      themePreference="system"
      onThemeChange={jest.fn()}
      unitPreference="metric"
      onUnitChange={jest.fn()}
      intervalsUnitPreference={null}
      primarySport="Running"
      onSportChange={jest.fn()}
      language="en-GB"
      onLanguageChange={jest.fn()}
    />
  );
}

describe('DisplaySettings', () => {
  it('puts the theme picker, sport picker and sport hint in one card', () => {
    const screen = renderDisplay();
    const cards = screen.UNSAFE_getAllByType(View).filter((v) => {
      const style = ([] as unknown[]).concat(v.props.style);
      return style.includes(settingsStyles.sectionCard);
    });
    expect(cards).toHaveLength(1);
    const card = within(cards[0]);
    expect(card.getByText('settings.primarySportHintRunning')).toBeTruthy();
    expect(card.getByText('filters.cycling')).toBeTruthy();
    expect(card.getByText('settings.primarySport')).toBeTruthy();
  });
});
