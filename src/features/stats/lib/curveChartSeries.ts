import { paceCurveSamples, type PaceCurveSample, type PaceCurveSource } from './paceCurvePoints';

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
