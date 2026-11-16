/**
 * Scenario: the insights page groups the cards the phone's reply makes and asks
 * the phone for the coming fortnight of planned events.
 *
 * Expected behaviour: a group sits where its best card sat, cards keep their
 * order inside it, the window runs from the start of today to the last second
 * of the fourteenth day after it, and only today's events are today's.
 */

import {
  eventsOn,
  groupByCategory,
  hasHistory,
  localDay,
  plannedWindow,
  type PlannedEvent,
} from '../../../web/connect/insightsPage';
import type { Insight } from '@/features/insights/types';

const card = (id: string, category: Insight['category']) => ({ id, category }) as Insight;

describe('groupByCategory', () => {
  it('orders groups by their first card and keeps card order within a group', () => {
    const groups = groupByCategory([
      card('a', 'route'),
      card('b', 'hrv_trend'),
      card('c', 'route'),
      card('d', 'hrv_trend'),
      card('e', 'section_pr'),
    ]);
    expect(groups.map((g) => [g.category, g.insights.map((i) => i.id)])).toEqual([
      ['route', ['a', 'c']],
      ['hrv_trend', ['b', 'd']],
      ['section_pr', ['e']],
    ]);
  });

  it('is empty for no cards', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('plannedWindow', () => {
  it('runs from the start of today to the last second of the final day, in wall-clock seconds', () => {
    const now = new Date(2026, 10, 14, 15, 30);
    const ask = plannedWindow(now, 14);
    expect(ask.oldestTs).toBe(Date.UTC(2026, 10, 14) / 1000);
    expect(ask.newestTs).toBe(Date.UTC(2026, 10, 28) / 1000 - 1);
  });

  it('crosses a month end', () => {
    const ask = plannedWindow(new Date(2026, 11, 25, 9), 14);
    expect(new Date(ask.newestTs * 1000).toISOString()).toBe('2027-01-07T23:59:59.000Z');
  });
});

describe('eventsOn', () => {
  it('keeps only the events on the day', () => {
    const events = [
      { id: 1, day: '2026-11-14' },
      { id: 2, day: '2026-11-15' },
    ] as PlannedEvent[];
    expect(eventsOn(events, localDay(new Date(2026, 10, 14))).map((e) => e.id)).toEqual([1]);
    expect(eventsOn(events, '2026-11-16')).toEqual([]);
  });
});

describe('hasHistory', () => {
  it('is true only for a card with a series of more than one point', () => {
    const withSeries = (n: number) =>
      ({
        supportingData: {
          history: { series: [{ points: Array.from({ length: n }, () => ({})) }] },
        },
      }) as unknown as Insight;
    expect(hasHistory(withSeries(2))).toBe(true);
    expect(hasHistory(withSeries(1))).toBe(false);
    expect(hasHistory({} as Insight)).toBe(false);
  });
});
