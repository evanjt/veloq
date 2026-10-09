/**
 * Scenario: the section screen lists laps only for an activity that crossed
 * the section more than once, and a flow that excludes a lap needs one in the
 * demo library to act on.
 *
 * Expected behaviour: one stable run repeats a closed loop that other demo
 * runs cover, in the same order each time, so the engine matches it to every
 * section on the loop once per lap and per direction.
 */

import { getActivities, getActivityMap, getActivityStreams } from '@/data/demo/fixtures';
import { getRouteCoordinates } from '@/shared/demo/routes/routes';
import { haversineDistance } from '@/shared/geo/distance';

const LAPPED_ID = 'demo-test-8';
const LAPS = 3;
const NEAR_METRES = 30;

type Routed = { id: string; type: string; _routeId?: string | null };

const activities = getActivities() as unknown as Routed[];
const lapped = activities.find((a) => a.id === LAPPED_ID);

function metres(a: [number, number], b: [number, number]): number {
  return haversineDistance(a[0], a[1], b[0], b[1]);
}

/** The order the track passes near each mark, one letter per visit. */
function visitOrder(track: [number, number][], marks: [number, number][]): string {
  let order = '';
  let last = -1;
  for (const point of track) {
    const at = marks.findIndex((m) => metres(point, m) < NEAR_METRES);
    if (at >= 0 && at !== last) order += 'ABC'[at];
    if (at >= 0) last = at;
  }
  return order;
}

describe('the demo lapped activity', () => {
  it('is a tracked run sharing its loop with other demo runs', () => {
    expect(lapped?.type).toBe('Run');
    const loop = lapped!._routeId!.replace(/-laps$/, '');
    expect(loop).not.toBe(lapped!._routeId);
    const rivals = activities.filter((a) => a.id !== LAPPED_ID && a._routeId === loop);
    expect(rivals.length).toBeGreaterThan(3);
  });

  it('runs the loop the same way round on every lap', () => {
    const base = getRouteCoordinates(lapped!._routeId!.replace(/-laps$/, ''));
    const track = getActivityMap(LAPPED_ID)!.latlngs as [number, number][];
    const marks = [0.25, 0.5, 0.75].map((f) => base[Math.floor(base.length * f)]);

    // Laps join where the loop closes, so a mark at both ends is one visit.
    const oneLap = visitOrder(base, marks);
    expect(oneLap.length).toBeGreaterThanOrEqual(marks.length);
    expect(visitOrder(track, marks)).toBe(oneLap.repeat(LAPS).replace(/(.)\1+/g, '$1'));
  });

  it('carries a time stream as long as its track, so each lap is timed', () => {
    const track = getActivityMap(LAPPED_ID)!.latlngs!;
    expect(getActivityStreams(LAPPED_ID)!.time).toHaveLength(track.length);
  });
});
