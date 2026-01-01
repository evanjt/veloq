import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import { colors, darkColors, brand } from './colors';

export {
  colors,
  darkColors,
  brand,
  gradients,
  glows,
  opacity,
  activityTypeColors,
  zoneColors,
  colorWithOpacity,
} from './colors';
export { spacing, layout } from './spacing';
export { typography } from './typography';
export { shadows, createShadow, cardShadow, smallElementShadow } from './shadows';

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.gold,
    primaryContainer: brand.goldLight,
    secondary: brand.blue,
    secondaryContainer: brand.blueLight,
    background: colors.background,
    surface: colors.surface,
    error: colors.error,
    onPrimary: colors.textOnPrimary,
    onSecondary: '#FFFFFF',
    onBackground: colors.textPrimary,
    onSurface: colors.textPrimary,
    outline: colors.border,
    surfaceVariant: colors.backgroundAlt,
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.gold,
    primaryContainer: brand.goldDark,
    secondary: brand.blue,
    secondaryContainer: brand.blueDark,
    background: darkColors.background,
    surface: darkColors.surface,
    error: darkColors.error,
    onPrimary: '#18181B', // Dark text on gold
    onSecondary: '#FFFFFF',
    onBackground: darkColors.textPrimary,
    onSurface: darkColors.textPrimary,
    outline: darkColors.border,
    surfaceVariant: darkColors.surfaceElevated,
  },
};
