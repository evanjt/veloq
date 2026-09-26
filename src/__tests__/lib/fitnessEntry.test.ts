/**
 * Scenario: an HRV or fitness-milestone card links to `/fitness`, and the tab
 * read no route params at all, so it opened on its default six-month range with
 * no day selected whatever window the card had summarised.
 *
 * Expected behaviour: the link carries the range and the day, the screen reads
 * them, and anything unparseable leaves the screen on its own defaults.
 */

import { fitnessEntryFromParams, fitnessTarget, rangeCovering } from '@/shared/app/fitnessEntry';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generateFitnessMilestoneInsights } from '@/features/insights/generators/fitnessMilestone';

describe('fitnessEntryFromParams', () => {
  it('takes a range and a day from the params', () => {
    expect(fitnessEntryFromParams({ range: '1m', date: '2026-09-14' })).toEqual({
      range: '1m',
      date: '2026-09-14',
    });
  });

  it('keeps the screen defaults when nothing is asked for', () => {
    expect(fitnessEntryFromParams({})).toEqual({ range: null, date: null });
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
    expect(fitnessEntryFromParams(query)).toEqual({ range: '1m', date: '2026-09-14' });
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
      { label: 'trendingDown', avg: 52, latest: 44, dataPoints: 14, sparkline: [52, 44] },
      now,
      t
    );

    expect(entryOf(insight.navigationTarget)).toEqual({ range: '1m', date: null });
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
    expect(entryOf(insights[0].navigationTarget)).toEqual({ range: null, date: '2026-09-14' });
  });
});
