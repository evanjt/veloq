/**
 * Scenario: demo mode stores a GPS track from the route geometry and a time
 * stream sized from the activity's moving time, so the two are never the same
 * length. The engine refuses to compute a lap time when they disagree, so every
 * `section_activities.lap_time` stays NULL, `activity_indicators` stays empty
 * and the feed card draws no section chip.
 *
 * Expected behaviour: a demo activity's time stream carries one value per
 * coordinate of the track that is stored for it.
 */

import { getActivityMap, getActivityStreams } from '@/shared/demo/activity';
import { storableTimeStreams } from '@/shared/demo/activity/streams';
import { getActivities } from '@/shared/demo/activity/activities';

function tracked() {
  return getActivities()
    .map((activity) => ({ id: activity.id, map: getActivityMap(activity.id, false) }))
    .filter((entry) => (entry.map?.latlngs?.length ?? 0) >= 4);
}

describe('demo time streams', () => {
  it('covers a useful number of demo activities', () => {
    expect(tracked().length).toBeGreaterThan(50);
  });

  it('carries one time value per track coordinate', () => {
    const mismatched = tracked()
      .map(({ id, map }) => ({
        id,
        coords: map!.latlngs!.length,
        times: getActivityStreams(id)?.time?.length ?? 0,
      }))
      .filter((entry) => entry.times > 0 && entry.times !== entry.coords);

    expect(mismatched).toEqual([]);
  });

  it('keeps the time stream monotonic and spanning the activity', () => {
    const [{ id }] = tracked();
    const times = getActivityStreams(id)!.time;

    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });
});

describe('storableTimeStreams', () => {
  const times = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("stores a stream that is the stored track's length", () => {
    expect(storableTimeStreams(['a'], () => times(3), new Map([['a', 3]]))).toEqual([
      { activityId: 'a', times: times(3) },
    ]);
  });

  it('drops a stream the engine would refuse to read', () => {
    expect(storableTimeStreams(['a'], () => times(4), new Map([['a', 3]]))).toEqual([]);
  });

  it('drops an activity whose track was never stored', () => {
    expect(storableTimeStreams(['a'], () => times(3), new Map())).toEqual([]);
  });

  it('drops an empty stream', () => {
    expect(storableTimeStreams(['a'], () => [], new Map([['a', 0]]))).toEqual([]);
  });
});
