import type { SeriesPoint } from '../types';

/**
 * Prints a pace series' value the way the engine did: the value of one of the
 * series' points reads that point's pace text in the unit system shown, with
 * `unit` after it. The chart places its axis marks on points (see
 * `marksOnSamples`), so every value it asks for is one; any other prints
 * nothing rather than a speed formatted here.
 */
export function paceSeriesFormat(
  points: readonly SeriesPoint[] | undefined,
  isMetric: boolean,
  unit = ''
): (value: number) => string {
  return (value) => {
    const point = points?.find((p) => p.value === value);
    const text = isMetric ? point?.metricText : point?.imperialText;
    return text == null ? '' : `${text}${unit}`;
  };
}
