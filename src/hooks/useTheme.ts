import { useColorScheme } from 'react-native';
import { brand, colors, darkColors } from '@/theme';

export interface ThemeColors {
  // Core brand
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  secondaryDark: string;
  secondaryLight: string;

  // Surfaces
  background: string;
  surface: string;
  card: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;

  // Semantic
  success: string;
  error: string;
  warning: string;

  // Borders
  border: string;
  divider: string;

  // Activity colors
  ride: string;
  run: string;
  swim: string;

  // Chart colors
  fitness: string;
  fatigue: string;
  form: string;
}

export interface Theme {
  isDark: boolean;
  colors: ThemeColors;
  // Commonly used style combinations
  styles: {
    container: { backgroundColor: string };
    card: { backgroundColor: string };
    text: { color: string };
    textSecondary: { color: string };
  };
}

export function useTheme(): Theme {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const themeColors: ThemeColors = {
    // Core brand - Gold primary, Blue secondary
    primary: brand.gold,
    primaryDark: brand.goldDark,
    primaryLight: brand.goldLight,
    secondary: brand.blue,
    secondaryDark: brand.blueDark,
    secondaryLight: brand.blueLight,

    // Surfaces
    background: isDark ? darkColors.background : colors.background,
    surface: isDark ? darkColors.surface : colors.surface,
    card: isDark ? darkColors.surfaceCard : colors.surface,

    // Text
    text: isDark ? darkColors.textPrimary : colors.textPrimary,
    textSecondary: isDark ? darkColors.textSecondary : colors.textSecondary,
    textMuted: isDark ? darkColors.textMuted : colors.textMuted,

    // Semantic
    success: isDark ? darkColors.success : colors.success,
    error: isDark ? darkColors.error : colors.error,
    warning: isDark ? darkColors.warning : colors.warning,

    // Borders
    border: isDark ? darkColors.border : colors.border,
    divider: isDark ? darkColors.divider : colors.divider,

    // Activity colors (same in both modes)
    ride: colors.ride,
    run: colors.run,
    swim: colors.swim,

    // Chart colors
    fitness: brand.blue,
    fatigue: colors.fatigue,
    form: brand.gold,
  };

  return {
    isDark,
    colors: themeColors,
    styles: {
      container: { backgroundColor: themeColors.background },
      card: { backgroundColor: themeColors.card },
      text: { color: themeColors.text },
      textSecondary: { color: themeColors.textSecondary },
    },
  };
}
