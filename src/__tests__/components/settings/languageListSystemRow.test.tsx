/**
 * Scenario: the language list leads with a row that follows the phone's language, and on iOS
 * offers the app's page in the Settings app, where the system's own per-app language lives.
 *
 * Expected behaviour: the row comes before every language, names the phone's language, stores
 * the system choice when tapped, and is the only row shown as chosen while the app follows the
 * phone.
 */

import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as Localization from 'expo-localization';

import { LanguageList } from '@/shared/ui/LanguageList';
import { SYSTEM_LANGUAGE, getAvailableLanguages } from '@/shared/app/LanguageStore';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

const firstLanguage = getAvailableLanguages()[0].languages[0].label;

beforeEach(() => {
  (Localization.getLocales as jest.Mock).mockReturnValue([
    { languageTag: 'fr-FR', languageCode: 'fr' },
  ]);
});

const selected = (screen: ReturnType<typeof render>, label: string) =>
  screen.getByLabelText(label).props.accessibilityState?.selected;

describe('the System row', () => {
  it('comes before every language and names the phone language', () => {
    const screen = render(<LanguageList language="de-CH" onSelect={jest.fn()} />);
    const row = screen.getByTestId('language-system');
    const all = screen.UNSAFE_root.findAll((n) => n.props.accessibilityRole === 'button');
    expect(all[0].props.testID).toBe('language-system');
    expect(all.findIndex((n) => n.props.accessibilityLabel === firstLanguage)).toBeGreaterThan(0);
    expect(row.props.accessibilityLabel).toContain('Français');
  });

  it('stores the system choice when tapped', () => {
    const onSelect = jest.fn();
    const screen = render(<LanguageList language="de-CH" onSelect={onSelect} />);
    fireEvent.press(screen.getByTestId('language-system'));
    expect(onSelect).toHaveBeenCalledWith(SYSTEM_LANGUAGE);
  });

  it('is the only row chosen while the app follows the phone', () => {
    const screen = render(<LanguageList language={SYSTEM_LANGUAGE} onSelect={jest.fn()} />);
    expect(screen.getByTestId('language-system').props.accessibilityState?.selected).toBe(true);
    expect(selected(screen, 'Français')).toBe(false);
  });

  it('is not chosen while a language is picked', () => {
    const screen = render(<LanguageList language="fr" onSelect={jest.fn()} />);
    expect(screen.getByTestId('language-system').props.accessibilityState?.selected).toBe(false);
    expect(selected(screen, 'Français')).toBe(true);
  });
});

describe("the app's page in the Settings app", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });

  it('is offered on iOS and opens the settings page', () => {
    Platform.OS = 'ios';
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const screen = render(<LanguageList language="fr" onSelect={jest.fn()} />);
    fireEvent.press(screen.getByTestId('language-open-settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('is not offered on Android, whose own page lists the app from its locale config', () => {
    Platform.OS = 'android';
    const screen = render(<LanguageList language="fr" onSelect={jest.fn()} />);
    expect(screen.queryByTestId('language-open-settings')).toBeNull();
  });
});
