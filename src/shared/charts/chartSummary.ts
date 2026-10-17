/**
 * The sentence a screen reader speaks for a chart, and the table its Show data sheet lists.
 *
 * Both are built here from the rows the chart plots, so no chart writes its own sentence and
 * the table always holds the numbers the sentence was read from. A missing or non-finite value
 * is a gap: it is skipped by every figure and shown as the absent mark in the table, never read
 * as zero.
 */

import type { TFunction } from 'i18next';

import { ABSENT } from '@/shared/format/absent';

/** One plotted value and the label of where it sits on the x axis, such as its day. */
export interface SummaryPoint {
  label: string;
  value: number | null | undefined;
  /** Tells two rows with the same label apart. Defaults to the label. */
  key?: string;
}

/** One drawn series: its name, its unit for a table header, and how a value is written. */
export interface SummarySeries {
  name: string;
  unit?: string | undefined;
  points: readonly SummaryPoint[];
  format: (value: number) => string;
  /** A pace, where the best of a curve is its lowest value rather than its highest. */
  lowerIsBetter?: boolean | undefined;
}

/** One named share of a chart, such as a zone and its time. */
export interface SummaryPart {
  label: string;
  value: string;
}

/** What the Show data sheet lists: a header per column, and one row of cells per plotted point. */
export interface ChartTable {
  title: string;
  columns: string[];
  rows: { key: string; cells: string[] }[];
}

function isPlotted(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function plotted(points: readonly SummaryPoint[]): { label: string; value: number }[] {
  return points.flatMap((p) => (isPlotted(p.value) ? [{ label: p.label, value: p.value }] : []));
}

/** A series over time: its span, its latest value, its range and its average. */
export function seriesSummary(series: SummarySeries, t: TFunction): string {
  const values = plotted(series.points);
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || !last) return t('charts.summary.empty', { name: series.name });
  if (values.length === 1) {
    return t('charts.summary.single', {
      name: series.name,
      start: first.label,
      value: series.format(first.value),
    });
  }
  let min = first.value;
  let max = first.value;
  let sum = 0;
  for (const { value } of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return t('charts.summary.series', {
    name: series.name,
    start: first.label,
    end: last.label,
    latest: series.format(last.value),
    min: series.format(min),
    max: series.format(max),
    average: series.format(sum / values.length),
  });
}

/** Several series drawn together, each read in turn under the chart's title. */
export function lanesSummary(title: string, lanes: readonly SummarySeries[], t: TFunction): string {
  return [
    t('charts.summary.title', { title }),
    ...lanes.map((lane) => seriesSummary(lane, t)),
  ].join(' ');
}

/**
 * A curve over a duration or a distance rather than time, where the last point is not the
 * latest: its first and last points and its best.
 */
export function curveSummary(series: SummarySeries, t: TFunction): string {
  const values = plotted(series.points);
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || !last) return t('charts.summary.empty', { name: series.name });
  if (values.length === 1) {
    return t('charts.summary.single', {
      name: series.name,
      start: first.label,
      value: series.format(first.value),
    });
  }
  const pick = series.lowerIsBetter ? Math.min : Math.max;
  const best = values.reduce((peak, { value }) => pick(peak, value), first.value);
  return t('charts.summary.curve', {
    name: series.name,
    start: first.label,
    end: last.label,
    first: series.format(first.value),
    last: series.format(last.value),
    max: series.format(best),
  });
}

/** A chart of named shares, such as zones, each listed with its value. */
export function partsSummary(title: string, parts: readonly SummaryPart[], t: TFunction): string {
  if (parts.length === 0) return t('charts.summary.empty', { name: title });
  return t('charts.summary.parts', {
    name: title,
    parts: parts.map(({ label, value }) => `${label} ${value}`).join(', '),
  });
}

function header(series: SummarySeries): string {
  return series.unit ? `${series.name} (${series.unit})` : series.name;
}

/**
 * The table for series that share their x positions, one row per point at which any series
 * has a value, in the order of the first series' points.
 */
export function seriesTable(
  title: string,
  xHeader: string,
  lanes: readonly SummarySeries[]
): ChartTable {
  const count = lanes.reduce((most, lane) => Math.max(most, lane.points.length), 0);
  const rows: ChartTable['rows'] = [];
  for (let i = 0; i < count; i++) {
    const cells = lanes.map((lane) => {
      const value = lane.points[i]?.value;
      return isPlotted(value) ? lane.format(value) : null;
    });
    if (cells.every((cell) => cell === null)) continue;
    const point = lanes.map((lane) => lane.points[i]).find((p) => p !== undefined);
    if (!point) continue;
    rows.push({
      key: point.key ?? point.label,
      cells: [point.label, ...cells.map((cell) => cell ?? ABSENT)],
    });
  }
  return { title, columns: [xHeader, ...lanes.map(header)], rows };
}

/** The table for a chart of named shares. */
export function partsTable(
  title: string,
  labelHeader: string,
  valueHeader: string,
  parts: readonly SummaryPart[]
): ChartTable {
  return {
    title,
    columns: [labelHeader, valueHeader],
    rows: parts.map(({ label, value }) => ({ key: label, cells: [label, value] })),
  };
}

/** One day of a calendar chart: how many activities it holds, and the cells its table row lists. */
export interface SummaryDay {
  label: string;
  /** Tells two days with the same label apart. Defaults to the label. */
  key?: string;
  /** Activities on the day. Zero is a day without one, which no table row lists. */
  count: number;
  /** The figure the day is coloured by, such as its longest session. */
  value?: number | null | undefined;
  /** The cells after the date in the day's table row. */
  cells: string[];
}

/** The days in order, their span, and how many hold an activity. */
function dayRun(name: string, days: readonly SummaryDay[], t: TFunction): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return t('charts.summary.empty', { name });
  const active = days.filter((day) => day.count > 0).length;
  if (days.length === 1) {
    return t(active > 0 ? 'charts.summary.dayActive' : 'charts.summary.dayRest', {
      name,
      start: first.label,
    });
  }
  if (active === 0) {
    return t('charts.summary.noActivity', { name, start: first.label, end: last.label });
  }
  return t('charts.summary.daysActive', {
    name,
    start: first.label,
    end: last.label,
    active,
    count: days.length,
  });
}

/**
 * A strip of days marked where any activity fell: the span, how many days hold one, and the
 * longest run of days between two that do.
 */
export function stripSummary(name: string, days: readonly SummaryDay[], t: TFunction): string {
  const run = dayRun(name, days, t);
  if (days.length < 2) return run;
  let longest = 0;
  let current = 0;
  let seen = false;
  for (const day of days) {
    if (day.count > 0) {
      if (seen) longest = Math.max(longest, current);
      seen = true;
      current = 0;
    } else {
      current += 1;
    }
  }
  if (longest === 0) return run;
  return `${run} ${t('charts.summary.longestBreak', {
    gap: t('charts.summary.dayCount', { count: longest }),
  })}`;
}

/**
 * A calendar of days shaded by a figure: the span, how many days hold an activity, and the day
 * with the highest figure.
 */
export function heatmapSummary(
  name: string,
  days: readonly SummaryDay[],
  format: (value: number) => string,
  t: TFunction
): string {
  const run = dayRun(name, days, t);
  let peak: { label: string; value: number } | null = null;
  for (const day of days) {
    if (day.count === 0 || !isPlotted(day.value)) continue;
    if (!peak || day.value > peak.value) peak = { label: day.label, value: day.value };
  }
  if (!peak) return run;
  return `${run} ${t('charts.summary.peakDay', { value: format(peak.value), day: peak.label })}`;
}

/** The table for a calendar chart: one row per day that holds an activity. */
export function daysTable(
  title: string,
  columns: readonly string[],
  days: readonly SummaryDay[]
): ChartTable {
  return {
    title,
    columns: [...columns],
    rows: days
      .filter((day) => day.count > 0)
      .map((day) => ({ key: day.key ?? day.label, cells: [day.label, ...day.cells] })),
  };
}
