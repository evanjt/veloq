import { colorWithOpacity, colourTokens, opacity } from '@/theme';

/**
 * The season comparison's paint. This year against last is the series colour
 * against the muted one, keyed by year beside the chart, and the current month
 * is a faint band of the series colour with its letter in primary text.
 */
export function seasonColours(isDark: boolean) {
  const tokens = colourTokens[isDark ? 'dark' : 'light'];
  return {
    current: tokens['chart-series'],
    previous: tokens['chart-muted'],
    currentMonthBand: colorWithOpacity(tokens['chart-series'], opacity.tint1),
    currentMonthLabel: tokens['text-primary'],
    monthLabel: tokens['text-secondary'],
  };
}
