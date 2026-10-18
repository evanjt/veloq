import type { PlacedLabel } from '@/shared/charts';
import { formatDecimal } from '@/shared/format';
import { getCurrentLanguage } from '@/i18n';
import { paceCurveSamples, type PaceCurveSample, type PaceCurveSource } from './paceCurvePoints';

const METRES_PER_MILE = 1609.344;

/** The height a performance curve's plot is given, apart from its card's header and footer. */
export const CURVE_PLOT_HEIGHT = 160;

/** A distance mark on the pace curve's log axis: where it sits and how it reads. */
interface DistanceMark {
  metres: number;
  /** The distance in the mark's unit, as it is printed, to `digits` places. */
  shown: number;
  digits: number;
  unit: 'm' | 'km' | 'mi';
}

// The race distances a runner reads a curve against, in each unit system. The
// imperial set keeps 5k, 10k and the half, and takes the quarter and the mile
// in place of 400 m and 1 km.
const METRIC_MARKS: readonly DistanceMark[] = [
  { metres: 400, shown: 400, digits: 0, unit: 'm' },
  { metres: 1000, shown: 1, digits: 0, unit: 'km' },
  { metres: 5000, shown: 5, digits: 0, unit: 'km' },
  { metres: 10000, shown: 10, digits: 0, unit: 'km' },
  { metres: 21097.5, shown: 21.1, digits: 1, unit: 'km' },
];
const IMPERIAL_MARKS: readonly DistanceMark[] = [
  { metres: METRES_PER_MILE / 4, shown: 0.25, digits: 2, unit: 'mi' },
  { metres: METRES_PER_MILE, shown: 1, digits: 0, unit: 'mi' },
  { metres: 5000, shown: 3.1, digits: 1, unit: 'mi' },
  { metres: 10000, shown: 6.2, digits: 1, unit: 'mi' },
  { metres: 21097.5, shown: 13.1, digits: 1, unit: 'mi' },
];

/**
 * The unit a pace axis is titled in. Its ticks print minutes and seconds, so
 * the title names minutes over the pace's distance, as `min/km`.
 */
export function paceAxisUnit(paceSuffix: string): string {
  return `min${paceSuffix}`;
}

const paceAxisLabels = new Map<string, PlacedLabel[]>();

/**
 * The pace curve's distance axis marks in the athlete's unit, each placed at
 * log10 of the distance it names. Kept per unit system and language, so the
 * chart's label placement sees the same array until either changes.
 */
export function paceCurveAxisLabels(isMetric: boolean): PlacedLabel[] {
  const key = `${getCurrentLanguage()}:${isMetric ? 'metric' : 'imperial'}`;
  let labels = paceAxisLabels.get(key);
  if (!labels) {
    labels = (isMetric ? METRIC_MARKS : IMPERIAL_MARKS).map((mark) => ({
      label: `${formatDecimal(mark.shown, mark.digits)} ${mark.unit}`,
      value: Math.log10(mark.metres),
    }));
    paceAxisLabels.set(key, labels);
  }
  return labels;
}

export interface PaceChartSeries {
  /** Every stored sample, shortest distance first, each with its pace in the chart's unit. */
  points: (PaceCurveSample & { pace: number })[];
  /** Slowest pace first, so faster paces sit at the top. Padded by a tenth of the span. */
  yDomain: [number, number];
  /** log10 of the shortest and longest stored distance. */
  xDomain: [number, number];
}

/** Every stored pace sample is plotted, and both axes span the complete stored curve. */
export function paceChartSeries(
  curve: PaceCurveSource | null | undefined,
  speedToPace: (speed: number) => number
): PaceChartSeries | null {
  const points = paceCurveSamples(curve)
    .map((s) => ({ ...s, pace: speedToPace(s.speed) }))
    .sort((a, b) => a.distance - b.distance);
  if (points.length === 0) return null;
  let minPace = Infinity;
  let maxPace = -Infinity;
  for (const p of points) {
    minPace = Math.min(minPace, p.pace);
    maxPace = Math.max(maxPace, p.pace);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const padding = (maxPace - minPace) * 0.1;
  return {
    points,
    yDomain: [maxPace + padding, minPace - padding],
    xDomain: [Math.log10(first.distance), Math.log10(last.distance)],
  };
}

export interface PowerChartPoint {
  secs: number;
  watts: number;
}

export interface PowerChartSeries {
  points: PowerChartPoint[];
  yDomain: [number, number];
}

/** Every stored duration with a positive value is plotted, shortest first. */
export function powerChartSeries(
  secs: readonly number[] | null | undefined,
  values: readonly number[] | null | undefined
): PowerChartSeries | null {
  if (!secs || !values) return null;
  const points: PowerChartPoint[] = [];
  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i];
    const watts = values[i];
    if (sec !== undefined && watts !== undefined && watts > 0 && sec > 0) {
      points.push({ secs: sec, watts });
    }
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.secs - b.secs);
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.watts);
    max = Math.max(max, p.watts);
  }
  const padding = (max - min) * 0.1;
  return { points, yDomain: [Math.max(0, min - padding), max + padding] };
}
