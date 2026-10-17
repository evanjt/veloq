/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that switch to the dark palette in dark mode.
 * The palette and its roles are defined in `src/theme/colors.ts`.
 */

import { useMemo } from 'react';
import { brand, colors, darkColors, colorWithOpacity, ink, themePalette, opacity } from '@/theme';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';

export interface ChartColorScheme {
  // Fitness metrics
  fitness: string;
  fatigue: string;
  form: string;

  // Activity metrics
  heartRate: string;
  cadence: string;
  elevation: string;

  // Wellness metrics
  hrv: string;
  rhr: string;
  sleep: string;
  sleepScore: string;
  weight: string;

  // Single-series curve charts
  ftp: string;
  powerCurve: string;
  paceCurve: string;
  swimCurve: string;

  // General chart colors
  primary: string;
  secondary: string;
  accent: string;

  // Chart UI elements
  grid: string;
  gridFaint: string;
  axis: string;
  label: string;
  tooltip: string;
  tooltipText: string;
  casing: string;
  zeroLine: string;
  zeroLineSolid: string;
  formLine: string;
  mutedBar: string;
  dotMuted: string;

  // Form zones (TSB)
  formHighRisk: string;
}

/**
 * Returns chart colors appropriate for the current color scheme.
 * Memoized to prevent unnecessary re-renders in consumers.
 */
export function useChartColors(): ChartColorScheme {
  const colorScheme = useResolvedColorScheme();
  const isDark = colorScheme === 'dark';

  return useMemo(
    () => ({
      // Fitness metrics - brand colors
      fitness: isDark ? darkColors.chartFitness : brand.blue,
      fatigue: isDark ? darkColors.chartFatigue : colors.fatigue,
      form: isDark ? darkColors.chartForm : brand.gold,

      // Activity metrics
      heartRate: isDark ? darkColors.chartHR : colors.error,
      cadence: isDark ? darkColors.chartCadence : colors.chartPurple,
      elevation: isDark ? darkColors.chartElevation : colors.gray600,

      // Wellness metrics
      hrv: isDark ? darkColors.chartHrv : colors.chartHrv,
      rhr: isDark ? darkColors.chartRhr : colors.chartRhr,
      sleep: isDark ? darkColors.chartSleep : colors.chartSleep,
      sleepScore: isDark ? darkColors.chartSleepScore : colors.chartSleepScore,
      weight: isDark ? darkColors.chartWeight : colors.chartWeight,

      // Single-series curve charts, stable across themes. Each curve belongs to
      // one sport and draws in that sport's colour, as every other screen does.
      ftp: colors.chartFtp,
      powerCurve: colors.ride,
      paceCurve: colors.run,
      swimCurve: colors.swim,

      // General chart colors
      primary: themePalette(isDark).primary,
      secondary: isDark ? brand.blueLight : brand.blue,
      accent: themePalette(isDark).primary,

      // Chart UI elements
      grid: isDark
        ? colorWithOpacity(ink.white, opacity.tint1)
        : colorWithOpacity(ink.black, opacity.tint1),
      gridFaint: isDark ? darkColors.chartGridFaint : colors.chartGridFaint,
      axis: isDark ? darkColors.textSecondary : colors.textSecondary,
      label: isDark ? darkColors.textSecondary : colors.textSecondary,
      tooltip: isDark ? darkColors.surfaceElevated : colors.surface,
      tooltipText: isDark ? darkColors.textPrimary : colors.textPrimary,
      casing: isDark ? darkColors.chartCasing : colors.chartCasing,
      zeroLine: isDark ? darkColors.chartZeroLine : colors.chartZeroLine,
      zeroLineSolid: isDark ? darkColors.chartZeroLineSolid : colors.chartZeroLineSolid,
      formLine: isDark ? darkColors.chartFormLine : colors.chartFormLine,
      mutedBar: isDark ? darkColors.chartMutedBar : colors.chartMutedBar,
      dotMuted: isDark ? darkColors.chartDotMuted : colors.chartDotMuted,

      // The one form zone a chart names for itself. The rest go through
      // `FORM_ZONE_COLORS`, which is where a zone's colour is decided.
      formHighRisk: colors.formHighRisk,
    }),
    [isDark]
  );
}
