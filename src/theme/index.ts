import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { colors } from './colors';

export { colors, gradients, glows } from './colors';
export { spacing, layout } from './spacing';
export { typography } from './typography';

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
    onPrimary: '#FFFFFF',
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
    secondary: colors.textSecondary,
    background: '#121212',
    surface: '#1E1E1E',
    error: colors.error,
    onPrimary: '#FFFFFF',
    onBackground: '#FFFFFF',
    onSurface: '#FFFFFF',
    outline: '#333333',
  },
};
