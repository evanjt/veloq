import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { colors, darkColors } from './colors';

export { colors, darkColors, gradients, glows, opacity } from './colors';
export { spacing, layout } from './spacing';
export { typography } from './typography';
export { shadows, createShadow, cardShadow, smallElementShadow } from './shadows';

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    primaryContainer: colors.primaryLight,
    secondary: colors.textSecondary,
    background: colors.background,
    surface: colors.surface,
    error: colors.error,
    onPrimary: colors.textOnDark,
    onBackground: colors.textPrimary,
    onSurface: colors.textPrimary,
    outline: colors.border,
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: colors.primary,
    primaryContainer: colors.primaryDark,
    secondary: darkColors.textSecondary,
    background: darkColors.background,
    surface: darkColors.surface,
    error: colors.error,
    onPrimary: colors.textOnDark,
    onBackground: darkColors.textPrimary,
    onSurface: darkColors.textPrimary,
    outline: darkColors.border,
  },
};
