/**
 * Where the fitness tab opens when a card sends the athlete there.
 *
 * An insight card summarises a window and a day. The tab read no params, so a
 * "HRV trending down over 14 days" card landed on the default six-month range
 * with nothing selected and the athlete scrolled for the window the card had
 * just described.
 */

import type { PrimarySport } from '@/features/fitness/stores';
import { PERIOD_DAYS, SPAN_PERIODS } from '@/shared/app/period';
import type { TimeRange } from '@/shared/app/timeRange';

/** The charts on the fitness tab a link can open. */
export const FITNESS_CHARTS = [
  'fitness',
  'form',
  'ftp',
  'pace',
  'css',
  'hrv',
  'rhr',
  'weight',
  'week',
  'calendar',
] as const;

export type FitnessChart = (typeof FITNESS_CHARTS)[number];

/** The pages of the fitness tab, in the order its tab row shows them. */
export const FITNESS_PLACES = ['fitness', 'calendar', 'performance', 'trends'] as const;

export type FitnessPlace = (typeof FITNESS_PLACES)[number];

export interface FitnessEntry {
  /** The range to open on, or null to keep the screen's own. */
  range: TimeRange | null;
  /** The day to select, `YYYY-MM-DD`, or null to select none. */
  date: string | null;
  /**
   * The chart to reveal, or null to open at the top. Optional because only the
   * screen reads it: the window an entry sets does not depend on it.
   */
  chart?: FitnessChart | null;
  /**
   * The page to open on, or null to let the chart decide. Optional for the
   * same reason as `chart`; `fitnessPlaceOf` is the page an entry opens on.
   */
  place?: FitnessPlace | null;
}

/** A collapsible section of the fitness tab. */
export type FitnessSection = 'performance' | 'trends';

/**
 * Where a chart sits on the fitness tab: the page that draws it, the section
 * to expand, if it is in one, and the sport the tab must show for it to be
 * drawn at all. Fitness and form are the always-open card at the top; the
 * wellness readings, the week and the calendar are always-open cards drawn for
 * every sport. Fitness, form and the wellness readings are on the fitness
 * page, the week and the calendar on the calendar page, the pace and swim
 * curves on the performance page and the eFTP trend on the trends page.
 */
export const FITNESS_CHART_PLACEMENT: Record<
  FitnessChart,
  { place: FitnessPlace; section: FitnessSection | null; sport: PrimarySport | null }
> = {
  fitness: { place: 'fitness', section: null, sport: null },
  form: { place: 'fitness', section: null, sport: null },
  ftp: { place: 'trends', section: 'trends', sport: 'Cycling' },
  pace: { place: 'performance', section: 'performance', sport: 'Running' },
  css: { place: 'performance', section: 'performance', sport: 'Swimming' },
  hrv: { place: 'fitness', section: null, sport: null },
  rhr: { place: 'fitness', section: null, sport: null },
  weight: { place: 'fitness', section: null, sport: null },
  week: { place: 'calendar', section: null, sport: null },
  calendar: { place: 'calendar', section: null, sport: null },
};

/**
 * The page an entry opens on: the named chart's page, else the named page,
 * else the fitness page. A chart wins over a page, so a link that names both
 * never opens on a page that does not draw its chart.
 */
export function fitnessPlaceOf(entry: Partial<FitnessEntry>): FitnessPlace {
  if (entry.chart) return FITNESS_CHART_PLACEMENT[entry.chart].place;
  return entry.place ?? 'fitness';
}

/** A place on the fitness tab a link scrolls to: a section, or a card outside one. */
export type FitnessAnchor = FitnessSection | 'chart' | 'wellness' | 'week' | 'calendar';

/** The always-open card that draws a chart, beside the fitness and form card. */
const FITNESS_CHART_CARD: Partial<Record<FitnessChart, FitnessAnchor>> = {
  hrv: 'wellness',
  rhr: 'wellness',
  weight: 'wellness',
  week: 'week',
  calendar: 'calendar',
};

/** Where the tab scrolls to reveal a chart: its card, else its section, else the top card. */
export function fitnessChartAnchor(chart: FitnessChart): FitnessAnchor {
  return FITNESS_CHART_CARD[chart] ?? FITNESS_CHART_PLACEMENT[chart].section ?? 'chart';
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isChart(value: string): value is FitnessChart {
  return (FITNESS_CHARTS as readonly string[]).includes(value);
}

function isPlace(value: string): value is FitnessPlace {
  return (FITNESS_PLACES as readonly string[]).includes(value);
}

function isRange(value: string): value is TimeRange {
  return (SPAN_PERIODS as readonly string[]).includes(value);
}

/** A day the chart can select: a real calendar date, written as the engine writes it. */
function isDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The range, day, chart and page a set of route params asks for. The page is
 * the `tab` param, as the insights tab names its own. Anything
 * unparseable is dropped rather than guessed, so a stale or hand-typed link
 * opens the screen on its own defaults instead of an invented window.
 */
export function fitnessEntryFromParams(params: {
  range?: string | string[];
  date?: string | string[];
  chart?: string | string[];
  tab?: string | string[];
}): FitnessEntry {
  const range = first(params.range);
  const date = first(params.date);
  const chart = first(params.chart);
  const place = first(params.tab);
  return {
    range: range && isRange(range) ? range : null,
    date: date && isDay(date) ? date : null,
    chart: chart && isChart(chart) ? chart : null,
    place: place && isPlace(place) ? place : null,
  };
}

/** Expo router hands a repeated param as an array. The first one wins. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The narrowest range that still covers a trailing window, so a fourteen-day
 * verdict opens on a month rather than six of them.
 */
export function rangeCovering(days: number): TimeRange {
  const covering = SPAN_PERIODS.find((period) => PERIOD_DAYS[period] >= days);
  return covering ?? SPAN_PERIODS[SPAN_PERIODS.length - 1];
}

/** The link a card uses to open the fitness tab on its own window, chart or page. */
export function fitnessTarget(entry: Partial<FitnessEntry>): string {
  const params = new URLSearchParams();
  if (entry.range) params.set('range', entry.range);
  if (entry.date) params.set('date', entry.date);
  if (entry.chart) params.set('chart', entry.chart);
  if (entry.place) params.set('tab', entry.place);
  const query = params.toString();
  return query ? `/fitness?${query}` : '/fitness';
}
