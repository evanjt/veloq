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
export { iconSizes, iconSizesByContext } from './icons';
export { chartStyles } from './chartStyles';

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.tealLight, // Teal-600 for light mode
    primaryContainer: brand.teal,
    secondary: brand.blueDark,
    secondaryContainer: brand.blue,
    tertiary: brand.goldDark, // Gold as tertiary (achievements)
    tertiaryContainer: brand.gold,
    background: colors.background,
    surface: colors.surface,
    error: colors.error,
    onPrimary: '#FFFFFF', // White text on teal
    onSecondary: '#FFFFFF',
    onTertiary: '#18181B', // Dark text on gold
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
    primary: brand.tealDark, // Teal-400 for dark mode
    primaryContainer: brand.teal,
    secondary: brand.blue,
    secondaryContainer: brand.blueLight,
    tertiary: brand.gold, // Gold as tertiary (achievements)
    tertiaryContainer: brand.goldLight,
    background: darkColors.background,
    surface: darkColors.surface,
    error: darkColors.error,
    onPrimary: '#18181B', // Dark text on bright teal
    onSecondary: '#FFFFFF',
    onTertiary: '#18181B', // Dark text on gold
    onBackground: darkColors.textPrimary,
    onSurface: darkColors.textPrimary,
    outline: darkColors.border,
    surfaceVariant: darkColors.surfaceElevated,
  },
};
