import { brand, colors, darkColors, themePalette, type Palette } from '@/theme';

import { useOpaqueChromeStore, useResolvedColorScheme } from './ThemeProvider';

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

  // Semantic
  success: string;
  error: string;
  warning: string;

  // Borders
  border: string;
  divider: string;

  // Chart colors
  fitness: string;
  fatigue: string;
}

export interface Theme {
  isDark: boolean;
  /**
   * Reduce Transparency or Increase Contrast on iOS, high-contrast text on
   * Android: chrome drawn over a map or a scrolling list draws on an opaque
   * surface instead of a fade or a translucent fill.
   */
  preferOpaqueChrome: boolean;
  colors: ThemeColors;
  /** Every role of the active theme, for a colour the short list above does not carry. */
  palette: Palette;
  // Commonly used style combinations
  styles: {
    container: { backgroundColor: string };
    card: { backgroundColor: string };
    text: { color: string };
    textSecondary: { color: string };
  };
}

export function useTheme(): Theme {
  const colorScheme = useResolvedColorScheme();
  const isDark = colorScheme === 'dark';
  const preferOpaqueChrome = useOpaqueChromeStore((s) => s.preferOpaqueChrome);
  const palette = themePalette(isDark);

  const themeColors: ThemeColors = {
    // Core brand: the theme's primary, Blue secondary, Gold for achievements
    primary: palette.actionPrimary,
    primaryDark: palette.actionPrimaryHover,
    primaryLight: palette.actionSecondary,
    secondary: brand.blue,
    secondaryDark: brand.blueDark,
    secondaryLight: brand.blueLight,

    // Surfaces
    background: isDark ? darkColors.surfacePage : colors.surfacePage,
    surface: isDark ? darkColors.surface : colors.surface,
    card: isDark ? darkColors.surfaceRaised : colors.surface,

    // Text
    text: isDark ? darkColors.textPrimary : colors.textPrimary,
    textSecondary: isDark ? darkColors.textSecondary : colors.textSecondary,

    // Semantic
    success: isDark ? darkColors.successText : colors.successText,
    error: isDark ? darkColors.errorText : colors.errorText,
    warning: isDark ? darkColors.warningText : colors.warningText,

    // Borders
    border: isDark ? darkColors.border : colors.border,
    divider: isDark ? darkColors.border : colors.border,

    // Chart colors
    fitness: palette.fitness,
    fatigue: palette.fatigue,
  };

  return {
    isDark,
    preferOpaqueChrome,
    colors: themeColors,
    palette,
    styles: {
      container: { backgroundColor: themeColors.background },
      card: { backgroundColor: themeColors.card },
      text: { color: themeColors.text },
      textSecondary: { color: themeColors.textSecondary },
    },
  };
}
