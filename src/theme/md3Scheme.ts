import type { MD3Theme } from 'react-native-paper';

import { brand, colorWithOpacity, colors, darkColors, ink, opacity } from './colors';

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
  primary: brand.tealLight,
  primaryContainer: brand.teal,
  secondary: brand.blueDark,
  secondaryContainer: brand.blue,
  tertiary: brand.goldDark,
  tertiaryContainer: brand.gold,
  surface: colors.surface,
  surfaceVariant: colors.backgroundAlt,
  surfaceDisabled: colorWithOpacity(colors.textPrimary, DISABLED_FILL),
  background: colors.background,
  error: colors.error,
  errorContainer: colors.errorBg,
  // Dark ink on the teal: white reads 3.74:1 on it, short of the 4.5:1 a label owes.
  onPrimary: colors.textOnPrimary,
  onPrimaryContainer: colors.textPrimary,
  onSecondary: ink.white,
  onSecondaryContainer: colors.textPrimary,
  onTertiary: colors.textPrimary,
  onTertiaryContainer: colors.textPrimary,
  onSurface: colors.textPrimary,
  onSurfaceVariant: colors.textSecondary,
  onSurfaceDisabled: colorWithOpacity(colors.textPrimary, DISABLED_LABEL),
  onError: colors.textPrimary,
  onErrorContainer: colors.errorDeep,
  onBackground: colors.textPrimary,
  outline: colors.border,
  outlineVariant: colors.borderLight,
  inverseSurface: colors.gray800,
  inverseOnSurface: colors.gray100,
  inversePrimary: brand.tealDark,
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
  primary: brand.tealDark,
  primaryContainer: brand.teal,
  secondary: brand.blue,
  secondaryContainer: brand.blueLight,
  tertiary: brand.gold,
  tertiaryContainer: brand.goldLight,
  surface: darkColors.surface,
  surfaceVariant: darkColors.surfaceElevated,
  surfaceDisabled: colorWithOpacity(darkColors.textPrimary, DISABLED_FILL),
  background: darkColors.background,
  error: darkColors.error,
  errorContainer: colors.errorDeep,
  onPrimary: colors.textOnPrimary,
  // The container is the bright teal, which white reads 3.74:1 on.
  onPrimaryContainer: colors.textOnBright,
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
  outlineVariant: darkColors.divider,
  inverseSurface: colors.gray100,
  inverseOnSurface: colors.gray800,
  // The light theme's teal reads 3.74:1 on a light inverse surface, so the
  // action takes its deeper hover step.
  inversePrimary: brand.tealHover,
  shadow: ink.black,
  scrim: ink.black,
  backdrop: opacity.overlay.scrim,
  // Dark surfaces lift by tone, along the app's own surface steps.
  elevation: {
    level0: 'transparent',
    level1: darkColors.surface,
    level2: darkColors.surfaceElevated,
    level3: darkColors.surfaceCard,
    level4: darkColors.surfaceCard,
    level5: darkColors.surfaceCard,
  },
};
