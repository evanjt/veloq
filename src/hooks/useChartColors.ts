/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that automatically adjust for dark mode,
 * providing better visibility and contrast on dark backgrounds.
 */

import { useColorScheme } from 'react-native';
import { colors, darkColors } from '@/theme';

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
 */
export function useChartColors(): ChartColorScheme {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return {
    // Fitness metrics - brighter in dark mode
    fitness: isDark ? darkColors.chartFitness : colors.fitness,
    fatigue: isDark ? darkColors.chartFatigue : colors.fatigue,
    form: isDark ? darkColors.chartForm : colors.form,

    // Activity metrics
    power: isDark ? darkColors.chartPower : colors.chartYellow,
    pace: isDark ? darkColors.chartPace : colors.chartGreen,
    heartRate: isDark ? darkColors.chartHR : colors.error,
    cadence: isDark ? darkColors.chartCadence : colors.chartPurple,
    elevation: isDark ? darkColors.chartElevation : colors.gray600,

    // General chart colors
    primary: colors.primary,
    secondary: isDark ? '#64B5F6' : colors.chartBlue,
    tertiary: isDark ? '#81C784' : colors.chartGreen,
    accent: colors.chartYellow,

    // Chart UI elements
    grid: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    axis: isDark ? darkColors.textMuted : colors.textSecondary,
    label: isDark ? darkColors.textSecondary : colors.textSecondary,
    tooltip: isDark ? darkColors.surfaceElevated : colors.surface,
    tooltipText: isDark ? darkColors.textPrimary : colors.textPrimary,

    // Zone colors (consistent across themes for recognition)
    zone1: '#90CAF9', // Recovery - Light blue
    zone2: '#4CAF50', // Endurance - Green
    zone3: '#FFEB3B', // Tempo - Yellow
    zone4: '#FF9800', // Threshold - Orange
    zone5: '#F44336', // VO2max - Red
    zone6: '#9C27B0', // Anaerobic - Purple
    zone7: '#E91E63', // Neuromuscular - Pink
  };
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
