/**
 * Hook for getting theme-aware chart colors.
 *
 * Returns chart colors that switch to the dark palette in dark mode.
 * The palette and its roles are defined in `src/theme/colors.ts`.
 */

import { useMemo } from 'react';
import { chartStreamColour, colors, colourTokens, darkColors } from '@/theme';
import { useResolvedColorScheme } from '@/shared/app/ThemeProvider';

export interface ChartColorScheme {
  // Fitness metrics, one hue each on every surface
  fitness: string;
  fatigue: string;

  /** A single-series chart: trends, sparklines, histograms, wellness rows. */
  series: string;
  /** A series set back beside the one that matters: the weaker period, context dots. */
  muted: string;

  // Single-series curve charts. The eFTP trend draws in the power stream's colour.
  ftp: string;
  powerCurve: string;
  paceCurve: string;
  swimCurve: string;

  // The furniture: the dotted grid, the solid baseline and zero line, a dashed
  // reference rule such as an average, and the scrub line.
  grid: string;
  axis: string;
  reference: string;
  crosshair: string;
  formLine: string;

  // The mark set: a dot's ring, the reticle and the record
  surface: string;
  ink: string;
  achievement: string;
  /** A line drawn at the record, in the record's gold at text contrast. */
  recordLine: string;
  /** The ring round a selected point. */
  focus: string;
}

/**
 * Returns chart colors appropriate for the current color scheme, one key per
 * chart token. Memoized to prevent unnecessary re-renders in consumers.
 */
export function useChartColors(): ChartColorScheme {
  const colorScheme = useResolvedColorScheme();
  const isDark = colorScheme === 'dark';

  return useMemo(() => {
    const tokens = colourTokens[isDark ? 'dark' : 'light'];
    return {
      fitness: tokens['fitness-ctl'],
      fatigue: tokens['fatigue-atl'],

      series: tokens['chart-series'],
      muted: tokens['chart-muted'],

      // Single-series curve charts draw in the colour of what they measure:
      // the power curve in power, both pace curves in speed, the stream colours
      // an activity's own charts use for the same measurement.
      ftp: tokens['stream-power'],
      powerCurve: chartStreamColour('power', isDark),
      paceCurve: chartStreamColour('pace', isDark),
      swimCurve: chartStreamColour('pace', isDark),

      grid: tokens['chart-grid'],
      axis: tokens['chart-axis'],
      reference: tokens['chart-reference'],
      crosshair: tokens['chart-crosshair'],
      formLine: isDark ? darkColors.chartFormLine : colors.chartFormLine,

      // A dot's ring is the surface it sits on, the reticle is ink, and gold
      // is the record alone.
      surface: tokens.surface,
      ink: tokens['text-primary'],
      achievement: tokens.achievement,
      recordLine: tokens['achievement-text'],
      focus: tokens['focus-ring'],
    };
  }, [isDark]);
}
