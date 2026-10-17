import type { MD3Theme } from 'react-native-paper';

import { brand, colorWithOpacity, colors, darkColors, ink, opacity } from './colors';
import { colourTokens } from './colourTokens.generated';

type MD3Scheme = MD3Theme['colors'];

// The whole Material 3 role set, built from the brand and zinc tokens. Typed as
// the full scheme, so a role left out fails to compile rather than falling
// through to the library's purple baseline. Paper reads roles the app never
// names: the snackbar's inverse surface and action, a text input's outline and
// label, a raised surface's elevation. Dynamic colour stays off, since colour
// carries data meaning here and a wallpaper must not repaint it.

// Disabled fills and labels at the Material 3 opacities.
const DISABLED_FILL = 0.12;
const DISABLED_LABEL = 0.38;

export const md3LightScheme: MD3Scheme = {
  primary: colors.actionPrimary,
  primaryContainer: colors.actionSecondary,
  secondary: brand.blueDark,
  secondaryContainer: brand.blue,
  tertiary: brand.goldDark,
  tertiaryContainer: brand.gold,
  surface: colors.surface,
  surfaceVariant: colors.surfaceInput,
  surfaceDisabled: colorWithOpacity(colors.textPrimary, DISABLED_FILL),
  background: colors.surfacePage,
  error: colors.errorText,
  errorContainer: colors.errorBg,
  onPrimary: colors.textOnFill,
  onPrimaryContainer: colors.textPrimary,
  onSecondary: ink.white,
  onSecondaryContainer: colors.textPrimary,
  onTertiary: colors.textPrimary,
  onTertiaryContainer: colors.textPrimary,
  onSurface: colors.textPrimary,
  onSurfaceVariant: colors.textSecondary,
  onSurfaceDisabled: colorWithOpacity(colors.textPrimary, DISABLED_LABEL),
  onError: colors.textPrimary,
  onErrorContainer: colors.errorText,
  onBackground: colors.textPrimary,
  outline: colors.border,
  outlineVariant: colors.border,
  inverseSurface: colourTokens.light['neutral-800'],
  inverseOnSurface: colourTokens.light['neutral-50'],
  inversePrimary: darkColors.actionLink,
  shadow: ink.black,
  scrim: ink.black,
  backdrop: opacity.overlay.scrim,
  // Light surfaces lift by shadow, not by tint, the same as the app's own cards.
  elevation: {
    level0: 'transparent',
    level1: colors.surface,
    level2: colors.surface,
    level3: colors.surface,
    level4: colors.surface,
    level5: colors.surface,
  },
};

export const md3DarkScheme: MD3Scheme = {
  primary: darkColors.actionPrimary,
  primaryContainer: darkColors.actionSecondary,
  secondary: brand.blue,
  secondaryContainer: brand.blueLight,
  tertiary: brand.gold,
  tertiaryContainer: brand.goldLight,
  surface: darkColors.surface,
  surfaceVariant: darkColors.surfaceRaised,
  surfaceDisabled: colorWithOpacity(darkColors.textPrimary, DISABLED_FILL),
  background: darkColors.surfacePage,
  error: darkColors.errorText,
  errorContainer: colors.errorText,
  onPrimary: colors.textOnFill,
  // The container is the light blue step, which white reads 2.23:1 on.
  onPrimaryContainer: darkColors.textPrimary,
  // Dark ink on the blue: white reads 2.96:1 on it.
  onSecondary: colors.textPrimary,
  onSecondaryContainer: colors.textPrimary,
  onTertiary: colors.textPrimary,
  onTertiaryContainer: colors.textPrimary,
  onSurface: darkColors.textPrimary,
  onSurfaceVariant: darkColors.textSecondary,
  onSurfaceDisabled: colorWithOpacity(darkColors.textPrimary, DISABLED_LABEL),
  onError: colors.textPrimary,
  onErrorContainer: darkColors.textPrimary,
  onBackground: darkColors.textPrimary,
  outline: darkColors.border,
  outlineVariant: darkColors.border,
  inverseSurface: colourTokens.light['neutral-50'],
  inverseOnSurface: colourTokens.light['neutral-800'],
  // The light theme's own primary, on a light inverse surface.
  inversePrimary: colors.actionPrimary,
  shadow: ink.black,
  scrim: ink.black,
  backdrop: opacity.overlay.scrim,
  // Dark surfaces lift by tone, along the app's own surface steps.
  elevation: {
    level0: 'transparent',
    level1: darkColors.surface,
    level2: darkColors.surfaceRaised,
    level3: darkColors.surfaceRaised,
    level4: darkColors.surfaceRaised,
    level5: darkColors.surfaceRaised,
  },
};
