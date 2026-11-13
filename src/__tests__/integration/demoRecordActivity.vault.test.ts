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

import { getActivities, getActivityMap, getActivityStreams } from '@/data/demo/fixtures';
import { haversineDistance } from '@/shared/geo/distance';

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

/** The shortest ground a section is cut over, and the longest stretch measured. */
const SHORTEST_STRETCH_M = 200;
const LONGEST_STRETCH_M = 2000;
/** How close a point has to lie to the record ride's track to count as shared ground. */
const SHARED_GROUND_M = 60;

type Track = [number, number][];

function trackOf(id: string): Track {
  return (getActivityMap(id)?.latlngs ?? []) as Track;
}

/**
 * Speeds over every stretch of `track` between the bounds, as the engine reads a lap: the
 * distance ridden between two points over the time stream's gap between them. `keep` limits
 * the stretches to those whose ends both satisfy it.
 */
function stretchSpeeds(track: Track, times: number[], keep: (i: number) => boolean): number[] {
  let metres = 0;
  let previous: [number, number] | undefined;
  const points = track.map((point, i) => {
    if (previous) metres += haversineDistance(...previous, ...point);
    previous = point;
    return { along: metres, time: times[i] ?? NaN, kept: keep(i) };
  });
  const speeds: number[] = [];
  for (const [i, from] of points.entries()) {
    if (!from.kept) continue;
    for (const to of points.slice(i + 1)) {
      const covered = to.along - from.along;
      if (covered > LONGEST_STRETCH_M) break;
      if (covered < SHORTEST_STRETCH_M || !to.kept) continue;
      speeds.push(covered / Math.max(to.time - from.time, 0.001));
    }
  }
  return speeds;
}

describe('the record ride against every other ride over shared ground', () => {
  const recordTrack = trackOf(RECORD_ID);
  const recordTimes = getActivityStreams(RECORD_ID)!.time!;
  const slowestRecordStretch = Math.min(...stretchSpeeds(recordTrack, recordTimes, () => true));
  const onRecordGround = (point: [number, number]) =>
    recordTrack.some((other) => haversineDistance(...point, ...other) <= SHARED_GROUND_M);
  const rides = (getActivities() as unknown as (Routed & { type: string })[]).filter(
    (a) => a.type === 'Ride' && a.id !== RECORD_ID
  );

  it('measures shared ground for rides on both demo ride routes', () => {
    const sharing = new Set(
      rides.filter((a) => trackOf(a.id).some(onRecordGround)).map((a) => a._routeId)
    );
    expect(sharing.size).toBeGreaterThan(1);
  });

  it('is never outpaced, so a section of any length keeps its record', () => {
    const outpacing: string[] = [];
    for (const ride of rides) {
      const track = trackOf(ride.id);
      const times = getActivityStreams(ride.id)?.time ?? [];
      if (track.length < 2 || times.length !== track.length) continue;
      const shared = track.map(onRecordGround);
      const fastest = Math.max(0, ...stretchSpeeds(track, times, (i) => shared[i] === true));
      if (fastest >= slowestRecordStretch) {
        outpacing.push(`${ride.id} ${fastest.toFixed(1)} m/s`);
      }
    }
    expect({ slowestRecordStretch, outpacing }).toEqual({
      slowestRecordStretch: expect.any(Number),
      outpacing: [],
    });
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
