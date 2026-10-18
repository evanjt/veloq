/**
 * Scenario: an HRV or fitness-milestone card links to `/fitness`, and the tab
 * read no route params at all, so it opened on its default six-month range with
 * no day selected whatever window the card had summarised.
 *
 * Expected behaviour: the link carries the range and the day, the screen reads
 * them, and anything unparseable leaves the screen on its own defaults.
 */

import {
  FITNESS_CHARTS,
  FITNESS_CHART_PLACEMENT,
  fitnessEntryFromParams,
  fitnessPlaceOf,
  fitnessTarget,
  rangeCovering,
} from '@/shared/app/fitnessEntry';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';
import { datedSeries } from '../__shared__/datedSeries';

describe('fitnessEntryFromParams', () => {
  it('takes a range and a day from the params', () => {
    expect(fitnessEntryFromParams({ range: '1m', date: '2026-09-14' })).toEqual({
      range: '1m',
      date: '2026-09-14',
      chart: null,
      place: null,
    });
  });

  it('keeps the screen defaults when nothing is asked for', () => {
    expect(fitnessEntryFromParams({})).toEqual({
      range: null,
      date: null,
      chart: null,
      place: null,
    });
  });

  it('drops a range that is not one of the periods', () => {
    expect(fitnessEntryFromParams({ range: '2w' }).range).toBeNull();
    expect(fitnessEntryFromParams({ range: 'all' }).range).toBeNull();
  });

  it('drops a date that is not a real day', () => {
    for (const date of ['2026-13-01', '2026-02-30', '14/09/2026', '2026-9-4', '']) {
      expect(fitnessEntryFromParams({ date }).date).toBeNull();
    }
  });

  it('takes the first of a repeated param', () => {
    expect(fitnessEntryFromParams({ range: ['3m', '7d'] }).range).toBe('3m');
  });

  it('takes a place from the tab param', () => {
    expect(fitnessEntryFromParams({ tab: 'calendar' }).place).toBe('calendar');
    expect(fitnessEntryFromParams({ tab: ['trends', 'calendar'] }).place).toBe('trends');
  });

  it('drops a tab that is not one of the places', () => {
    expect(fitnessEntryFromParams({ tab: 'nowhere' }).place).toBeNull();
    expect(fitnessEntryFromParams({ tab: '' }).place).toBeNull();
    expect(fitnessEntryFromParams({}).place).toBeNull();
  });
});

describe('fitnessPlaceOf', () => {
  const PLACE_OF_CHART = {
    fitness: 'fitness',
    form: 'fitness',
    hrv: 'fitness',
    rhr: 'fitness',
    weight: 'fitness',
    week: 'calendar',
    calendar: 'calendar',
    pace: 'performance',
    css: 'performance',
    ftp: 'trends',
  } as const;

  it('opens each chart on the place that draws it', () => {
    for (const chart of FITNESS_CHARTS) {
      expect(FITNESS_CHART_PLACEMENT[chart].place).toBe(PLACE_OF_CHART[chart]);
      expect(fitnessPlaceOf({ chart })).toBe(PLACE_OF_CHART[chart]);
    }
  });

  it('lets a chart win over a place that does not draw it', () => {
    expect(fitnessPlaceOf({ chart: 'ftp', place: 'calendar' })).toBe('trends');
  });

  it('opens on the named place when no chart is named', () => {
    expect(fitnessPlaceOf({ chart: null, place: 'performance' })).toBe('performance');
  });

  it('opens on the fitness place when nothing is named', () => {
    expect(fitnessPlaceOf({})).toBe('fitness');
    expect(fitnessPlaceOf({ range: '1m' })).toBe('fitness');
    expect(fitnessPlaceOf(fitnessEntryFromParams({}))).toBe('fitness');
  });
});

describe('rangeCovering', () => {
  it('opens on the narrowest range that holds the window', () => {
    expect(rangeCovering(7)).toBe('7d');
    expect(rangeCovering(14)).toBe('1m');
    expect(rangeCovering(30)).toBe('1m');
    expect(rangeCovering(45)).toBe('3m');
  });

  it('falls back to the widest range for a window longer than any of them', () => {
    expect(rangeCovering(4000)).toBe('1y');
  });
});

describe('fitnessTarget', () => {
  it('round-trips through the params the screen reads', () => {
    const target = fitnessTarget({ range: rangeCovering(14), date: '2026-09-14' });

    expect(target).toBe('/fitness?range=1m&date=2026-09-14');
    const query = Object.fromEntries(new URLSearchParams(target.split('?')[1]));
    expect(fitnessEntryFromParams(query)).toEqual({
      range: '1m',
      date: '2026-09-14',
      chart: null,
      place: null,
    });
  });

  it('carries a chart beside the range and the day', () => {
    const target = fitnessTarget({ range: '3m', chart: 'ftp' });

    expect(target).toBe('/fitness?range=3m&chart=ftp');
    const query = Object.fromEntries(new URLSearchParams(target.split('?')[1]));
    expect(fitnessEntryFromParams(query)).toEqual({
      range: '3m',
      date: null,
      chart: 'ftp',
      place: null,
    });
  });

  it('carries a place, and round-trips it', () => {
    const target = fitnessTarget({ place: 'calendar' });

    expect(target).toBe('/fitness?tab=calendar');
    const query = Object.fromEntries(new URLSearchParams(target.split('?')[1]));
    expect(fitnessEntryFromParams(query)).toEqual({
      range: null,
      date: null,
      chart: null,
      place: 'calendar',
    });
  });

  it('is the bare tab when there is nothing to carry', () => {
    expect(fitnessTarget({})).toBe('/fitness');
  });
});

describe('the cards that link to the fitness tab', () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof generateHrvTrendInsight>[2];
  const now = Date.UTC(2026, 8, 18);

  function entryOf(target: string | undefined) {
    const query = target?.split('?')[1] ?? '';
    return fitnessEntryFromParams(Object.fromEntries(new URLSearchParams(query)));
  }

  it('sends an HRV verdict to the range its window fits in', () => {
    const [insight] = generateHrvTrendInsight(
      {
        label: 'trendingDown',
        avg: 52,
        latest: 44,
        dataPoints: 14,
        sparkline: datedSeries([52, 44]),
      },
      now,
      t
    );

    expect(entryOf(insight.navigationTarget)).toEqual({
      range: '1m',
      date: null,
      chart: null,
      place: null,
    });
  });

  it('sends an FTP step to the day it was dated', () => {
    const insights = generateFitnessMilestoneInsights(
      {
        latestFtp: 280,
        latestDate: Date.UTC(2026, 8, 14) / 1000,
        previousFtp: 265,
        deltaWatts: 15,
        sampleCount: 12,
      },
      null,
      null,
      now,
      t
    );

    expect(insights.length).toBeGreaterThan(0);
    expect(entryOf(insights[0].navigationTarget)).toEqual({
      range: null,
      date: '2026-09-14',
      chart: null,
      place: null,
    });
  });
});

describe('rangeCovering against the period table', () => {
  it('reads its spans from the one period table, so a changed span moves it', () => {
    jest.isolateModules(() => {
      jest.doMock('@/shared/app/period', () => {
        const actual = jest.requireActual('@/shared/app/period');
        return { ...actual, PERIOD_DAYS: { ...actual.PERIOD_DAYS, '1m': 28 } };
      });
      const { rangeCovering: covering } = require('@/shared/app/fitnessEntry');

      expect(covering(28)).toBe('1m');
      expect(covering(30)).toBe('3m');
    });
  });
});
