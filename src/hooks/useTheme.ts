import { useColorScheme } from 'react-native';
import { colors, darkColors } from '@/theme';

export interface ThemeColors {
  // Core
  primary: string;
  primaryDark: string;
  primaryLight: string;

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
    // Core
    primary: colors.primary,
    primaryDark: colors.primaryDark,
    primaryLight: colors.primaryLight,

    // Surfaces
    background: isDark ? darkColors.background : colors.background,
    surface: isDark ? darkColors.surface : colors.surface,
    card: isDark ? '#1E1E1E' : '#FFFFFF',

    // Text
    text: isDark ? darkColors.textPrimary : colors.textPrimary,
    textSecondary: isDark ? darkColors.textSecondary : colors.textSecondary,
    textMuted: isDark ? '#666666' : '#999999',

    // Semantic
    success: colors.success,
    error: colors.error,
    warning: colors.warning,

    // Borders
    border: isDark ? darkColors.border : colors.border,
    divider: isDark ? darkColors.divider : colors.divider,

    // Activity colors (same in both modes)
    ride: colors.ride,
    run: colors.run,
    swim: colors.swim,

    // Chart colors
    fitness: colors.fitness,
    fatigue: colors.fatigue,
    form: colors.form,
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
