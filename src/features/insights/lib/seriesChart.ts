import type { Domain, PlacedLabel } from '@/shared/charts';

/** One sample of a history series. `date` is epoch seconds, absent for an undated series. */
export interface SeriesSample {
  value: number;
  date?: number | null | undefined;
  /** A total still accruing, such as the running week's. */
  partial?: boolean | undefined;
}

/** A sample as the chart draws it: `x` is the date, or the order for an undated series. */
export interface SeriesDatum {
  x: number;
  y: number;
  value: number;
  date: number | null;
  /** Position in the series the caller passed, before any sample was dropped. */
  index: number;
  partial: boolean;
}

export interface SeriesChartModel {
  data: SeriesDatum[];
  xDomain: Domain;
  /** Bottom edge first, so an inverted series carries its largest value first. */
  yDomain: Domain;
  xLabels: PlacedLabel[];
  /** Decimal places that tell neighbouring values apart over this series' range. */
  decimals: number;
}

interface SeriesChartOptions {
  formatDate: (epochSeconds: number) => string;
  /** Draw the lowest value at the top, for a time where lower is better. */
  invert?: boolean;
  /** Keep zero inside the value range, for bars that stand on it. */
  fromZero?: boolean;
}

/** Share of the span added above and below the data, and either side of the dates. */
const Y_PAD = 0.1;
const X_PAD = 0.08;
/** A middle date closer than this share of the axis to an end would crowd that end's label. */
const MIDDLE_CLEARANCE = 0.25;
/** A series this long gets a middle date. */
const MIDDLE_LABEL_MIN = 5;

function decimalsFor(span: number, magnitude: number): number {
  const scale = span > 0 ? span : magnitude;
  if (scale >= 3) return 0;
  if (scale >= 0.3) return 1;
  return 2;
}

/**
 * The axes of an insight history chart. A dated series is placed on its dates,
 * so a gap between two efforts takes the width it lasted, and the date labels
 * sit on samples: the first, the last, and the one nearest the middle when it
 * clears both ends.
 */
export function seriesChartModel(
  samples: readonly SeriesSample[],
  { formatDate, invert = false, fromZero = false }: SeriesChartOptions
): SeriesChartModel | null {
  const usable = samples
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample }) => Number.isFinite(sample.value));
  if (usable.length < 2) return null;

  const dates = usable.map(({ sample }) => sample.date);
  const dated =
    dates.every((date): date is number => typeof date === 'number' && Number.isFinite(date)) &&
    Math.max(...dates) > Math.min(...dates);

  const data: SeriesDatum[] = usable.map(({ sample, index }, order) => ({
    x: dated ? (sample.date as number) : order,
    y: sample.value,
    value: sample.value,
    date: dated ? (sample.date as number) : null,
    index,
    partial: sample.partial === true,
  }));
  data.sort((a, b) => a.x - b.x);

  const values = data.map((d) => d.value);
  const min = fromZero ? Math.min(0, ...values) : Math.min(...values);
  const max = fromZero ? Math.max(0, ...values) : Math.max(...values);
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const span = max - min;
  const pad = (span > 0 ? span : Math.max(magnitude, 1)) * Y_PAD;
  // A bar's length is its value, so the edge it stands on gets no padding.
  const bottom = fromZero && min === 0 ? 0 : min - pad;
  const top = fromZero && max === 0 ? 0 : max + pad;
  const yDomain: Domain = invert ? [max + pad, min - pad] : [bottom, top];

  const xs = data.map((d) => d.x);
  const first = Math.min(...xs);
  const last = Math.max(...xs);
  const xSpan = last - first;
  const xDomain: Domain = [first - xSpan * X_PAD, last + xSpan * X_PAD];

  const xLabels: PlacedLabel[] = [];
  if (dated) {
    xLabels.push({ label: formatDate(first), value: first });
    if (data.length >= MIDDLE_LABEL_MIN) {
      const centre = (first + last) / 2;
      const middle = data.reduce((best, d) =>
        Math.abs(d.x - centre) < Math.abs(best.x - centre) ? d : best
      );
      const share = (middle.x - first) / xSpan;
      if (share >= MIDDLE_CLEARANCE && share <= 1 - MIDDLE_CLEARANCE) {
        xLabels.push({ label: formatDate(middle.x), value: middle.x });
      }
    }
    xLabels.push({ label: formatDate(last), value: last });
  }

  return { data, xDomain, yDomain, xLabels, decimals: decimalsFor(span, magnitude) };
}
