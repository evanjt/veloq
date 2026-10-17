import type { ColorSchemeName } from 'react-native';
import type { Theme } from 'expo-router';

import { colors, darkColors } from './colors';
import { faceWeight, typeface } from './typography';

// The stack's header titles, back titles and tab labels draw the app's face at
// the weights it ships, through the slots the navigator reads them from.
const fonts: Theme['fonts'] = {
  regular: { fontFamily: typeface.family, fontWeight: faceWeight('400') },
  medium: { fontFamily: typeface.family, fontWeight: faceWeight('500') },
  bold: { fontFamily: typeface.family, fontWeight: faceWeight('700') },
  heavy: { fontFamily: typeface.family, fontWeight: faceWeight('800') },
};

function build(dark: boolean): Theme {
  const palette = dark ? darkColors : colors;
  return {
    dark,
    colors: {
      primary: palette.actionPrimary,
      background: palette.surfacePage,
      card: palette.surface,
      text: palette.textPrimary,
      border: palette.border,
      notification: palette.dangerFill,
    },
    fonts,
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
