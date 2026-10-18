/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that switch to the dark palette in dark mode.
 * The palette and its roles are defined in `src/theme/colors.ts`.
 */

import { useMemo } from 'react';
import {
  brand,
  chartStreamColour,
  colors,
  colourTokens,
  darkColors,
  colorWithOpacity,
  ink,
  themePalette,
  opacity,
} from '@/theme';
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

  // The mark set: a dot's ring, the reticle and the record
  surface: string;
  ink: string;
  achievement: string;
  baseline: string;
  /** A dashed reference rule, such as an average. */
  reference: string;
  /** The scrub line. */
  crosshair: string;

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

  return useMemo(() => {
    const tokens = colourTokens[isDark ? 'dark' : 'light'];
    return {
      // Fitness metrics
      fitness: isDark ? darkColors.fitness : colors.fitness,
      fatigue: isDark ? darkColors.fatigue : colors.fatigue,
      form: isDark ? darkColors.chartForm : brand.gold,

      // Activity metrics
      heartRate: chartStreamColour('heartrate', isDark),
      cadence: chartStreamColour('cadence', isDark),
      elevation: chartStreamColour('elevation', isDark),

      // Wellness metrics
      hrv: isDark ? darkColors.chartHrv : colors.chartHrv,
      rhr: isDark ? darkColors.chartRhr : colors.chartRhr,
      sleep: isDark ? darkColors.chartSleep : colors.chartSleep,
      sleepScore: isDark ? darkColors.chartSleepScore : colors.chartSleepScore,
      weight: isDark ? darkColors.chartWeight : colors.chartWeight,

      // Single-series curve charts. Each curve belongs to one sport and draws
      // in that sport's colour, as every other screen does; FTP is power.
      ftp: isDark ? darkColors.chartFtp : colors.chartFtp,
      powerCurve: colors.ride,
      paceCurve: colors.run,
      swimCurve: colors.swim,

      // General chart colors
      primary: themePalette(isDark).actionPrimary,
      secondary: isDark ? brand.blueLight : brand.blue,
      accent: themePalette(isDark).actionPrimary,

      // Chart UI elements
      grid: isDark
        ? colorWithOpacity(ink.white, opacity.tint1)
        : colorWithOpacity(ink.black, opacity.tint1),
      gridFaint: isDark ? darkColors.chartGridFaint : colors.chartGridFaint,
      axis: isDark ? darkColors.textSecondary : colors.textSecondary,
      label: isDark ? darkColors.textSecondary : colors.textSecondary,
      tooltip: isDark ? darkColors.surfaceRaised : colors.surface,
      tooltipText: isDark ? darkColors.textPrimary : colors.textPrimary,
      casing: isDark ? darkColors.chartCasing : colors.chartCasing,
      zeroLine: isDark ? darkColors.chartZeroLine : colors.chartZeroLine,
      zeroLineSolid: isDark ? darkColors.chartZeroLineSolid : colors.chartZeroLineSolid,
      formLine: isDark ? darkColors.chartFormLine : colors.chartFormLine,
      mutedBar: isDark ? darkColors.chartMutedBar : colors.chartMutedBar,
      dotMuted: isDark ? darkColors.chartDotMuted : colors.chartDotMuted,

      // A dot's ring is the surface it sits on, the reticle is ink, and gold
      // is the record alone. The baseline is the solid axis under the plot.
      surface: tokens.surface,
      ink: tokens['text-primary'],
      achievement: tokens.achievement,
      baseline: tokens['chart-axis'],
      reference: tokens['chart-reference'],
      crosshair: tokens['chart-crosshair'],

      // The one form zone a chart names for itself. The rest go through
      // `formZoneColor`, which is where a zone's colour is decided.
      formHighRisk: isDark ? darkColors.formHighRisk : colors.formHighRisk,
    };
  }, [isDark]);
}
