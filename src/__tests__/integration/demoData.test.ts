/**
 * Integration tests using actual demo data.
 * Verifies the full data pipeline works with realistic fixtures,
 * and that fixtures themselves remain shape-valid, unique, and deterministic.
 */

import { calculateTSB } from '@/lib/algorithms/fitness';
import { sortByDateId } from '@/lib/utils/activityUtils';
import { demoWellness } from '@/data/demo/wellness';
import {
  fixtures,
  getActivityStreams,
  getActivityMap,
  type ApiActivity,
} from '@/data/demo/fixtures';
import { DEMO_REFERENCE_DATE } from '@/data/demo/random';

const demoActivities = fixtures.activities;

describe('Demo data integrity', () => {
  it('wellness TSB pipeline produces finite form values that track CTL - ATL', () => {
    const sorted = sortByDateId(demoWellness);
    const withTSB = calculateTSB(sorted);

    expect(withTSB.length).toBeGreaterThan(0);
    expect(demoWellness[demoWellness.length - 1].id).toBe(DEMO_REFERENCE_DATE);

    withTSB.forEach((day, i) => {
      expect(typeof day.tsb).toBe('number');
      expect(Number.isNaN(day.tsb)).toBe(false);
      expect(day.tsb).toBeGreaterThanOrEqual(-150);
      expect(day.tsb).toBeLessThanOrEqual(150);

      const ctl = day.ctl ?? day.ctlLoad ?? 0;
      const atl = day.atl ?? day.atlLoad ?? 0;
      expect(Math.abs(day.tsb - (ctl - atl))).toBeLessThanOrEqual(1);

      if (i > 0) {
        expect(withTSB[i].id >= withTSB[i - 1].id).toBe(true);
      }
    });
  });

  it('activity fixtures have valid types, unique IDs, and the expected stress-test count', () => {
    const validTypes = new Set([
      'Ride',
      'Run',
      'Swim',
      'Walk',
      'Hike',
      'VirtualRide',
      'VirtualRun',
      'Workout',
      'WeightTraining',
      'Yoga',
      'Other',
    ]);

    demoActivities.forEach((a: ApiActivity) => {
      expect(validTypes.has(a.type)).toBe(true);
    });

    const ids = demoActivities.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);

    const stress = demoActivities.filter((a) => a.id.startsWith('demo-stress-'));
    expect(stress.length).toBe(20);

    const dateBased = demoActivities.filter(
      (a) => !a.id.startsWith('demo-test-') && !a.id.startsWith('demo-stress-')
    );
    dateBased.forEach((a) => {
      expect(a.id).toMatch(/^demo-\d{4}-\d{2}-\d{2}-\d+$/);
    });
  });

  it('streams are deterministic, monotonic, and have realistic HR ranges', () => {
    const samples = demoActivities.filter((a) => a.distance && a.distance > 0).slice(0, 3);
    expect(samples.length).toBeGreaterThan(0);

    samples.forEach((activity) => {
      const first = getActivityStreams(activity.id);
      const second = getActivityStreams(activity.id);
      expect(first).not.toBeNull();
      if (!first || !second) return;

      expect(second.time).toEqual(first.time);
      expect(second.heartrate).toEqual(first.heartrate);
      expect(second.distance).toEqual(first.distance);

      if (first.time && first.time.length > 1) {
        for (let i = 1; i < first.time.length; i++) {
          expect(first.time[i]).toBeGreaterThan(first.time[i - 1]);
        }
      }

      if (first.distance && first.distance.length > 1) {
        for (let i = 1; i < first.distance.length; i++) {
          expect(first.distance[i]).toBeGreaterThanOrEqual(first.distance[i - 1] * 0.95);
        }
      }

      first.heartrate?.forEach((hr) => {
        expect(hr).toBeGreaterThanOrEqual(60);
        expect(hr).toBeLessThanOrEqual(200);
      });
    });
  });
});

describe('Demo data realism (periodization model)', () => {
  it('FTP varies across activities — not all 250W', () => {
    const ftpValues = new Set(demoActivities.map((a) => a.icu_ftp));
    expect(ftpValues.size).toBeGreaterThan(3);
  });

  it('CTL has a visible dip from illness block — not monotonically increasing', () => {
    const wellness = fixtures.wellness;
    const ctlValues = wellness.map((w) => w.ctl);
    let hasDecline = false;
    for (let i = 10; i < ctlValues.length; i++) {
      if (ctlValues[i] < ctlValues[i - 10] - 3) {
        hasDecline = true;
        break;
      }
    }
    expect(hasDecline).toBe(true);
  });

  it('activity count per week varies — irregular cadence', () => {
    const weekCounts = new Map<string, number>();
    const dateBased = demoActivities.filter(
      (a) => !a.id.startsWith('demo-test-') && !a.id.startsWith('demo-stress-')
    );
    dateBased.forEach((a) => {
      const d = new Date(a.start_date_local);
      const weekKey = `${d.getFullYear()}-W${Math.floor((d.getMonth() * 30 + d.getDate()) / 7)}`;
      weekCounts.set(weekKey, (weekCounts.get(weekKey) || 0) + 1);
    });
    const counts = [...weekCounts.values()];
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(max - min).toBeGreaterThanOrEqual(3);
  });

  it('GPS coordinates vary between activities on the same route', () => {
    const rioRuns = demoActivities.filter(
      (a: ApiActivity & { _routeId?: string }) =>
        (a as { _routeId?: string })._routeId === 'route-rio-run-1' &&
        !a.id.startsWith('demo-test-') &&
        !a.id.startsWith('demo-stress-')
    );
    if (rioRuns.length < 2) return;
    const map1 = getActivityMap(rioRuns[0].id);
    const map2 = getActivityMap(rioRuns[1].id);
    if (!map1?.latlngs || !map2?.latlngs) return;
    const coordsDiffer =
      map1.latlngs.length !== map2.latlngs.length ||
      map1.latlngs.some((c, i) => c[0] !== map2.latlngs![i][0] || c[1] !== map2.latlngs![i][1]);
    expect(coordsDiffer).toBe(true);
  });

  it('zone distributions differ between session types', () => {
    const rides = demoActivities.filter(
      (a) => (a.type === 'Ride' || a.type === 'VirtualRide') && a.icu_zone_times
    );
    if (rides.length < 5) return;
    const z2Percentages = rides.slice(0, 10).map((a) => {
      const total = a.icu_zone_times!.reduce((s, z) => s + z.secs, 0);
      const z2 = a.icu_zone_times!.find((z) => z.id === 'Z2')?.secs || 0;
      return total > 0 ? z2 / total : 0;
    });
    const min = Math.min(...z2Percentages);
    const max = Math.max(...z2Percentages);
    expect(max - min).toBeGreaterThan(0.1);
  });

  it('weight trends downward during training season — not periodic sine wave', () => {
    const wellness = fixtures.wellness;
    const firstQuarterAvg = wellness.slice(0, 90).reduce((s, w) => s + (w.weight ?? 75), 0) / 90;
    const thirdQuarterAvg = wellness.slice(180, 270).reduce((s, w) => s + (w.weight ?? 75), 0) / 90;
    expect(firstQuarterAvg).toBeGreaterThan(thirdQuarterAvg);
  });

  it('stress test demo-stress-0 has the fastest time', () => {
    const stressActivities = demoActivities
      .filter((a) => a.id.startsWith('demo-stress-'))
      .sort((a, b) => {
        const numA = parseInt(a.id.split('-')[2], 10);
        const numB = parseInt(b.id.split('-')[2], 10);
        return numA - numB;
      });
    expect(stressActivities.length).toBe(20);
    const fastest = stressActivities[0];
    stressActivities.slice(1).forEach((a) => {
      expect(a.moving_time).toBeGreaterThanOrEqual(fastest.moving_time);
    });
  });

  it('stable test activities exist with correct IDs and types', () => {
    const expected = [
      { id: 'demo-test-0', type: 'Ride' },
      { id: 'demo-test-1', type: 'Run' },
      { id: 'demo-test-2', type: 'VirtualRide' },
      { id: 'demo-test-3', type: 'Hike' },
      { id: 'demo-test-4', type: 'Swim' },
      { id: 'demo-test-5', type: 'Run' },
      { id: 'demo-test-6', type: 'WeightTraining' },
    ];
    expected.forEach(({ id, type }) => {
      const found = demoActivities.find((a) => a.id === id);
      expect(found).toBeDefined();
      expect(found!.type).toBe(type);
    });
  });
});
