/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that automatically adjust for dark mode,
 * providing better visibility and contrast on dark backgrounds.
 *
 * Brand Identity: Gold (#D4AF37) + Blue (#5B9BD5)
 */

import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { brand, colors, darkColors, zoneColors } from '@/theme';

export interface ChartColorScheme {
  // Fitness metrics
  fitness: string;
  fatigue: string;
  form: string;

  // Activity metrics
  power: string;
  pace: string;
  heartRate: string;
  cadence: string;
  elevation: string;

  // General chart colors
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;

  // Chart UI elements
  grid: string;
  axis: string;
  label: string;
  tooltip: string;
  tooltipText: string;

  // Zone colors (power/HR)
  zone1: string;
  zone2: string;
  zone3: string;
  zone4: string;
  zone5: string;
  zone6: string;
  zone7: string;
}

/**
 * Returns chart colors appropriate for the current color scheme.
 * Memoized to prevent unnecessary re-renders in consumers.
 */
export function useChartColors(): ChartColorScheme {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return useMemo(
    () => ({
      // Fitness metrics - brand colors
      fitness: isDark ? darkColors.chartFitness : brand.blue,
      fatigue: isDark ? darkColors.chartFatigue : colors.fatigue,
      form: isDark ? darkColors.chartForm : brand.gold,

      // Activity metrics
      power: isDark ? darkColors.chartPower : colors.chartAmber,
      pace: isDark ? darkColors.chartPace : colors.chartGreen,
      heartRate: isDark ? darkColors.chartHR : colors.error,
      cadence: isDark ? darkColors.chartCadence : colors.chartPurple,
      elevation: isDark ? darkColors.chartElevation : colors.gray600,

      // General chart colors
      primary: isDark ? brand.tealDark : brand.tealLight,
      secondary: isDark ? brand.blueLight : brand.blue,
      tertiary: isDark ? '#4ADE80' : colors.chartGreen,
      accent: isDark ? brand.tealDark : brand.tealLight,

      // Chart UI elements
      grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
      axis: isDark ? darkColors.textMuted : colors.textSecondary,
      label: isDark ? darkColors.textSecondary : colors.textSecondary,
      tooltip: isDark ? darkColors.surfaceElevated : colors.surface,
      tooltipText: isDark ? darkColors.textPrimary : colors.textPrimary,

      // Zone colors (consistent across themes for recognition)
      zone1: zoneColors.zone1,
      zone2: zoneColors.zone2,
      zone3: zoneColors.zone3,
      zone4: zoneColors.zone4, // Amber, NOT orange
      zone5: zoneColors.zone5,
      zone6: zoneColors.zone6,
      zone7: zoneColors.zone7,
    }),
    [isDark]
  );
}

/**
 * Get a specific chart color for a given metric type.
 */
export type ChartMetricType =
  | 'fitness'
  | 'fatigue'
  | 'form'
  | 'power'
  | 'pace'
  | 'heartRate'
  | 'cadence'
  | 'elevation';

export function useChartColor(metric: ChartMetricType): string {
  const chartColors = useChartColors();
  return chartColors[metric];
}

/**
 * Get zone colors array for power or heart rate zones.
 */
export function useZoneColors(): string[] {
  const chartColors = useChartColors();
  return [
    chartColors.zone1,
    chartColors.zone2,
    chartColors.zone3,
    chartColors.zone4,
    chartColors.zone5,
    chartColors.zone6,
    chartColors.zone7,
  ];
}

/**
 * Get fitness metric colors as an object.
 */
export function useFitnessColors() {
  const chartColors = useChartColors();
  return {
    ctl: chartColors.fitness,
    atl: chartColors.fatigue,
    tsb: chartColors.form,
  };
}
