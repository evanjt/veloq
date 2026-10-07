/**
 * Scenario: the summary card's hero and supporting metrics opened a bare tab,
 * or nothing at all for week hours and week count, and neither tab read a
 * chart from the route, so no tap could reach the chart the metric summarised.
 *
 * Expected behaviour: every metric and every hero the picker offers resolves
 * to a route whose tab accepts its chart, and that chart is placed on screen.
 */

import { AVAILABLE_METRICS, HERO_METRICS, type MetricId } from '@/features/home/store';
import { summaryCardTarget } from '@/features/home/lib/summaryCardTargets';
import {
  FITNESS_CHART_PLACEMENT,
  fitnessEntryFromParams,
  type FitnessChart,
} from '@/shared/app/fitnessEntry';
import {
  TRAINING_CHART_CARD,
  trainingEntryFromParams,
  type TrainingChart,
} from '@/shared/app/trainingEntry';

/** The tab and the chart its own parser reads out of a target. */
function resolve(target: string): { tab: string; chart: FitnessChart | TrainingChart | null } {
  const [pathname, query = ''] = target.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (pathname === '/fitness')
    return { tab: pathname, chart: fitnessEntryFromParams(params).chart ?? null };
  if (pathname === '/training')
    return { tab: pathname, chart: trainingEntryFromParams(params).chart };
  return { tab: pathname, chart: null };
}

const EVERY_METRIC = AVAILABLE_METRICS.map((m) => m.id);

describe('summary card targets', () => {
  it.each(EVERY_METRIC)('%s opens a tab on a chart that tab accepts', (metric) => {
    const { tab, chart } = resolve(summaryCardTarget(metric));

    expect(['/fitness', '/training']).toContain(tab);
    expect(chart).not.toBeNull();
  });

  it.each([...HERO_METRICS])('the %s hero opens a chart too', (hero) => {
    expect(resolve(summaryCardTarget(hero)).chart).not.toBeNull();
  });

  it('places every chart it opens', () => {
    for (const metric of EVERY_METRIC) {
      const { tab, chart } = resolve(summaryCardTarget(metric));
      const placement =
        tab === '/fitness'
          ? FITNESS_CHART_PLACEMENT[chart as FitnessChart]
          : TRAINING_CHART_CARD[chart as TrainingChart];
      expect(placement).toBeDefined();
    }
  });

  it.each<[MetricId, string, string]>([
    ['fitness', '/fitness', 'fitness'],
    ['form', '/fitness', 'form'],
    ['ftp', '/fitness', 'ftp'],
    ['thresholdPace', '/fitness', 'pace'],
    ['css', '/fitness', 'css'],
    ['hrv', '/training', 'hrv'],
    ['rhr', '/training', 'rhr'],
    ['weight', '/training', 'weight'],
    ['weekHours', '/training', 'week'],
    ['weekCount', '/training', 'week'],
  ])('%s opens %s on %s', (metric, tab, chart) => {
    expect(resolve(summaryCardTarget(metric))).toEqual({ tab, chart });
  });
});

describe('the tab parsers', () => {
  it('drop a chart neither tab draws', () => {
    expect(fitnessEntryFromParams({ chart: 'hrv' }).chart).toBeNull();
    expect(trainingEntryFromParams({ chart: 'ftp' }).chart).toBeNull();
    expect(trainingEntryFromParams({}).chart).toBeNull();
  });

  it('take the first of a repeated chart param', () => {
    expect(fitnessEntryFromParams({ chart: ['ftp', 'css'] }).chart).toBe('ftp');
    expect(trainingEntryFromParams({ chart: ['week', 'hrv'] }).chart).toBe('week');
  });

  it('expand the section and switch to the sport a fitness chart needs', () => {
    expect(FITNESS_CHART_PLACEMENT.ftp).toEqual({ section: 'trends', sport: 'Cycling' });
    expect(FITNESS_CHART_PLACEMENT.css).toEqual({ section: 'performance', sport: 'Swimming' });
    expect(FITNESS_CHART_PLACEMENT.fitness).toEqual({ section: null, sport: null });
  });
});
