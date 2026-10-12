import type { ColorSchemeName } from 'react-native';
import { DefaultTheme, type Theme } from 'expo-router';

import { colors, darkColors } from './colors';

function build(dark: boolean): Theme {
  const palette = dark ? darkColors : colors;
  return {
    dark,
    colors: {
      primary: palette.primary,
      background: palette.background,
      card: palette.surface,
      text: palette.textPrimary,
      border: palette.border,
      notification: palette.error,
    },
    fonts: DefaultTheme.fonts,
  };
}

const themes = { light: build(false), dark: build(true) };

/**
 * The navigation theme for a resolved scheme. The native stack paints every
 * pushed card and sheet container with its background, and with none passed
 * falls back to the library's light grey, dark mode included.
 */
export function navigationTheme(scheme: ColorSchemeName): Theme {
  return scheme === 'dark' ? themes.dark : themes.light;
}
