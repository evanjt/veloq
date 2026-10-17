/**
 * Scenario: the native stack paints every pushed card and every sheet container
 * with the navigation theme's background. With no theme passed it falls back to
 * the library's light grey, so dark mode shows a light ground behind a push and
 * inside a sheet.
 *
 * Expected behaviour: the navigation theme is built from the app's tokens for
 * the resolved scheme, and the provider hands the dark one to the stack when
 * the app is dark, following a flip of the preference.
 */
import React, { act } from 'react';
import { render } from '@testing-library/react-native';
import { Text, type ColorSchemeName } from 'react-native';
import { useTheme } from 'expo-router';

import { navigationTheme } from '@/theme/navigationTheme';
import { NavigationThemeProvider } from '@/shared/app/NavigationThemeProvider';
import { setThemePreference } from '@/shared/app/ThemeProvider';
import { colors, darkColors } from '@/theme';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

let mockSystemScheme: NonNullable<ColorSchemeName> = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
  __esModule: true,
  default: () => mockSystemScheme,
}));

describe('navigationTheme', () => {
  it('takes the dark tokens for the dark scheme', () => {
    const theme = navigationTheme('dark');
    expect(theme.dark).toBe(true);
    expect(theme.colors.background).toBe(darkColors.surfacePage);
    expect(theme.colors.card).toBe(darkColors.surface);
    expect(theme.colors.text).toBe(darkColors.textPrimary);
    expect(theme.colors.border).toBe(darkColors.border);
    expect(theme.colors.primary).toBe(darkColors.actionPrimary);
    expect(theme.colors.notification).toBe(darkColors.dangerFill);
  });

  it('takes the light tokens for the light scheme', () => {
    const theme = navigationTheme('light');
    expect(theme.dark).toBe(false);
    expect(theme.colors.background).toBe(colors.surfacePage);
    expect(theme.colors.card).toBe(colors.surface);
    expect(theme.colors.text).toBe(colors.textPrimary);
    expect(theme.colors.border).toBe(colors.border);
    expect(theme.colors.primary).toBe(colors.actionPrimary);
    expect(theme.colors.notification).toBe(colors.dangerFill);
  });

  it('carries the fonts the stack header reads', () => {
    expect(navigationTheme('dark').fonts.bold.fontFamily).toBeTruthy();
    expect(navigationTheme('light').fonts.regular.fontFamily).toBeTruthy();
  });

  it('returns the same object for the same scheme, so the stack does not re-render', () => {
    expect(navigationTheme('dark')).toBe(navigationTheme('dark'));
  });
});

describe('NavigationThemeProvider', () => {
  function Probe() {
    const theme = useTheme();
    return <Text testID="ground">{String(theme.colors.background)}</Text>;
  }

  afterEach(async () => {
    mockSystemScheme = 'light';
    await act(() => setThemePreference('system'));
  });

  it('hands the stack the dark ground, not the library default, when the system is dark', () => {
    mockSystemScheme = 'dark';
    const { getByTestId } = render(
      <NavigationThemeProvider>
        <Probe />
      </NavigationThemeProvider>
    );
    expect(getByTestId('ground').props.children).toBe(darkColors.surfacePage);
  });

  it('follows the in-app preference across a flip', async () => {
    const { getByTestId } = render(
      <NavigationThemeProvider>
        <Probe />
      </NavigationThemeProvider>
    );
    expect(getByTestId('ground').props.children).toBe(colors.surfacePage);
    await act(() => setThemePreference('dark'));
    expect(getByTestId('ground').props.children).toBe(darkColors.surfacePage);
    await act(() => setThemePreference('light'));
    expect(getByTestId('ground').props.children).toBe(colors.surfacePage);
  });
});
