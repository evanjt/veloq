/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that automatically adjust for dark mode,
 * providing better visibility and contrast on dark backgrounds.
 *
 * Brand Identity: Gold (#D4AF37) + Blue (#5B9BD5)
 */

import { useMemo } from 'react';
import { brand, colors, darkColors, zoneColors, colorWithOpacity, ink } from '@/theme';
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

  // Zone colors (power/HR)
  zone1: string;
  zone2: string;
  zone3: string;
  zone4: string;
  zone5: string;
  zone6: string;
  zone7: string;

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

      // Single-series curve charts, stable across themes
      ftp: colors.chartFtp,
      powerCurve: colors.chartPowerCurve,
      paceCurve: colors.chartPaceCurve,
      swimCurve: colors.chartSwimCurve,

      // General chart colors
      primary: isDark ? brand.tealDark : brand.tealLight,
      secondary: isDark ? brand.blueLight : brand.blue,
      accent: isDark ? brand.tealDark : brand.tealLight,

      // Chart UI elements
      grid: isDark ? colorWithOpacity(ink.white, 0.08) : colorWithOpacity(ink.black, 0.08),
      gridFaint: isDark ? darkColors.chartGridFaint : colors.chartGridFaint,
      axis: isDark ? darkColors.textMuted : colors.textSecondary,
      label: isDark ? darkColors.textSecondary : colors.textSecondary,
      tooltip: isDark ? darkColors.surfaceElevated : colors.surface,
      tooltipText: isDark ? darkColors.textPrimary : colors.textPrimary,
      casing: isDark ? darkColors.chartCasing : colors.chartCasing,
      zeroLine: isDark ? darkColors.chartZeroLine : colors.chartZeroLine,
      zeroLineSolid: isDark ? darkColors.chartZeroLineSolid : colors.chartZeroLineSolid,
      formLine: isDark ? darkColors.chartFormLine : colors.chartFormLine,
      mutedBar: isDark ? darkColors.chartMutedBar : colors.chartMutedBar,
      dotMuted: isDark ? darkColors.chartDotMuted : colors.chartDotMuted,

      // Zone colors (consistent across themes for recognition)
      zone1: zoneColors.zone1,
      zone2: zoneColors.zone2,
      zone3: zoneColors.zone3,
      zone4: zoneColors.zone4,
      zone5: zoneColors.zone5,
      zone6: zoneColors.zone6,
      zone7: zoneColors.zone7,

      // The one form zone a chart names for itself. The rest go through
      // `FORM_ZONE_COLORS`, which is where a zone's colour is decided.
      formHighRisk: colors.formHighRisk,
    }),
    [isDark]
  );
}
