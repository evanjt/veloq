/**
 * Scenario: the feed PR pill and the sections list record mark need a section
 * whose current record is held by an activity the flows can name. The demo
 * time stream is uniform over the stored track, so a section's lap time scales
 * with the activity's moving time on the same route.
 *
 * Expected behaviour: one stable ride is the newest on its route and is faster
 * than every other activity on it by a margin that track trimming and
 * dropouts cannot close.
 */

import { getActivities } from '@/data/demo/fixtures';

const RECORD_ID = 'demo-test-7';
const MARGIN = 0.9;

type Routed = { id: string; start_date_local: string; moving_time: number; _routeId?: string };

const activities = getActivities() as unknown as Routed[];
const record = activities.find((a) => a.id === RECORD_ID);
const rivals = activities.filter((a) => a.id !== RECORD_ID && a._routeId === record?._routeId);

describe('the demo record activity', () => {
  it('is a tracked ride with rivals on its route', () => {
    expect(record).toBeDefined();
    expect(record?._routeId).toBe('route-valais-ride-2');
    expect(rivals.length).toBeGreaterThan(10);
  });

  it('is the newest activity on its route, so the sections list marks it', () => {
    for (const rival of rivals) {
      expect(new Date(record!.start_date_local).getTime()).toBeGreaterThan(
        new Date(rival.start_date_local).getTime()
      );
    }
  });

  it('is faster than every rival by a margin jitter cannot close', () => {
    const fastestRival = Math.min(...rivals.map((a) => a.moving_time));
    expect(record!.moving_time).toBeLessThanOrEqual(fastestRival * MARGIN);
  });
});

type Fixtures = typeof import('@/data/demo/fixtures');

function activitiesOn(day: Date): Routed[] {
  jest.useFakeTimers({ now: day, doNotFake: ['setTimeout', 'setInterval', 'setImmediate'] });
  let loaded: Routed[] = [];
  jest.isolateModules(() => {
    const fixtures: Fixtures = require('@/data/demo/fixtures');
    loaded = fixtures.getActivities() as unknown as Routed[];
  });
  jest.useRealTimers();
  return loaded;
}

describe('the demo library on any day', () => {
  const days = Array.from({ length: 21 }, (_, i) => new Date(2027, 0, 4 + i, 0, 5));

  it.each(days)('starts no activity on the day it is opened (%s)', (day) => {
    const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const late = activitiesOn(day).filter(
      (a) => new Date(a.start_date_local).getTime() >= startOfDay
    );
    expect(late.map((a) => `${a.id} ${a.start_date_local}`)).toEqual([]);
  });

  it.each(days)('keeps the record ride the newest on its route (%s)', (day) => {
    const all = activitiesOn(day);
    const holder = all.find((a) => a.id === RECORD_ID)!;
    const newer = all.filter(
      (a) =>
        a.id !== RECORD_ID &&
        a._routeId === holder._routeId &&
        new Date(a.start_date_local).getTime() >= new Date(holder.start_date_local).getTime()
    );
    expect(newer.map((a) => `${a.id} ${a.start_date_local}`)).toEqual([]);
  });
});
