/**
 * Scenario: the summary card's hero and supporting metrics opened a bare tab,
 * or nothing at all for week hours and week count, and neither tab read a
 * chart from the route, so no tap could reach the chart the metric summarised.
 *
 * Expected behaviour: every metric and every hero the picker offers resolves
 * to the fitness tab on a chart it accepts, and that chart is placed on screen.
 */

import {
  AVAILABLE_METRICS,
  HERO_METRICS,
  type MetricId,
} from '@/features/settings/stores/summaryCardPreferences';
import { summaryCardTarget } from '@/features/home/lib/summaryCardTargets';
import {
  FITNESS_CHART_PLACEMENT,
  fitnessChartAnchor,
  fitnessEntryFromParams,
  type FitnessChart,
} from '@/shared/app/fitnessEntry';

/** The tab and the chart its own parser reads out of a target. */
function resolve(target: string): { tab: string; chart: FitnessChart | null } {
  const [pathname, query = ''] = target.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (pathname === '/fitness')
    return { tab: pathname, chart: fitnessEntryFromParams(params).chart ?? null };
  return { tab: pathname, chart: null };
}

const EVERY_METRIC = AVAILABLE_METRICS.map((m) => m.id);

describe('summary card targets', () => {
  it.each(EVERY_METRIC)('%s opens a tab on a chart that tab accepts', (metric) => {
    const { tab, chart } = resolve(summaryCardTarget(metric));

    expect(tab).toBe('/fitness');
    expect(chart).not.toBeNull();
  });

  it.each([...HERO_METRICS])('the %s hero opens a chart too', (hero) => {
    expect(resolve(summaryCardTarget(hero)).chart).not.toBeNull();
  });

  it('places every chart it opens', () => {
    for (const metric of EVERY_METRIC) {
      const { chart } = resolve(summaryCardTarget(metric));
      expect(FITNESS_CHART_PLACEMENT[chart as FitnessChart]).toBeDefined();
    }
  });

  it.each<[MetricId, string, string]>([
    ['fitness', '/fitness', 'fitness'],
    ['form', '/fitness', 'form'],
    ['ftp', '/fitness', 'ftp'],
    ['thresholdPace', '/fitness', 'pace'],
    ['css', '/fitness', 'css'],
    ['hrv', '/fitness', 'hrv'],
    ['rhr', '/fitness', 'rhr'],
    ['weight', '/fitness', 'weight'],
    ['weekHours', '/fitness', 'week'],
    ['weekCount', '/fitness', 'week'],
  ])('%s opens %s on %s', (metric, tab, chart) => {
    expect(resolve(summaryCardTarget(metric))).toEqual({ tab, chart });
  });
});

describe('the fitness parser', () => {
  it('reads the wellness, week and calendar charts the tab now draws', () => {
    expect(fitnessEntryFromParams({ chart: 'hrv' }).chart).toBe('hrv');
    expect(fitnessEntryFromParams({ chart: 'rhr' }).chart).toBe('rhr');
    expect(fitnessEntryFromParams({ chart: 'weight' }).chart).toBe('weight');
    expect(fitnessEntryFromParams({ chart: 'week' }).chart).toBe('week');
    expect(fitnessEntryFromParams({ chart: 'calendar' }).chart).toBe('calendar');
  });

  it('drops a chart the tab does not draw', () => {
    expect(fitnessEntryFromParams({ chart: 'sleep' }).chart).toBeNull();
    expect(fitnessEntryFromParams({}).chart).toBeNull();
  });

  it('takes the first of a repeated chart param', () => {
    expect(fitnessEntryFromParams({ chart: ['ftp', 'css'] }).chart).toBe('ftp');
    expect(fitnessEntryFromParams({ chart: ['week', 'hrv'] }).chart).toBe('week');
  });

  it('opens the sport-agnostic cards with no section and no sport switch', () => {
    for (const chart of ['hrv', 'rhr', 'weight', 'week', 'calendar'] as const) {
      expect(FITNESS_CHART_PLACEMENT[chart]).toMatchObject({ section: null, sport: null });
    }
  });

  it('scrolls each chart to the card that draws it', () => {
    expect(fitnessChartAnchor('hrv')).toBe('wellness');
    expect(fitnessChartAnchor('rhr')).toBe('wellness');
    expect(fitnessChartAnchor('weight')).toBe('wellness');
    expect(fitnessChartAnchor('week')).toBe('week');
    expect(fitnessChartAnchor('calendar')).toBe('calendar');
    expect(fitnessChartAnchor('fitness')).toBe('chart');
    expect(fitnessChartAnchor('ftp')).toBe('trends');
    expect(fitnessChartAnchor('css')).toBe('performance');
  });

  it('expand the section and switch to the sport a fitness chart needs', () => {
    expect(FITNESS_CHART_PLACEMENT.ftp).toEqual({
      section: 'trends',
      sport: 'Cycling',
      place: 'trends',
    });
    expect(FITNESS_CHART_PLACEMENT.css).toEqual({
      section: 'performance',
      sport: 'Swimming',
      place: 'performance',
    });
    expect(FITNESS_CHART_PLACEMENT.fitness).toEqual({
      section: null,
      sport: null,
      place: 'fitness',
    });
  });
});
