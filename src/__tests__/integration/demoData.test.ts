/**
 * Integration tests using actual demo data.
 * Verifies the full data pipeline works with realistic fixtures,
 * and that fixtures themselves remain shape-valid, unique, and deterministic.
 */

import { calculateTSB } from '@/lib/algorithms/fitness';
import { sortByDateId } from '@/lib/utils/activityUtils';
import { demoWellness } from '@/data/demo/wellness';
import { fixtures, getActivityStreams, type ApiActivity } from '@/data/demo/fixtures';
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
      // Allow rounding drift of 1 between tsb and ctl-atl
      expect(Math.abs(day.tsb - (ctl - atl))).toBeLessThanOrEqual(1);

      if (i > 0) {
        // sortByDateId must yield ascending ids through the pipeline
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

      // Determinism: regenerating produces identical arrays
      expect(second.time).toEqual(first.time);
      expect(second.heartrate).toEqual(first.heartrate);
      expect(second.distance).toEqual(first.distance);

      // Monotonic time
      if (first.time && first.time.length > 1) {
        for (let i = 1; i < first.time.length; i++) {
          expect(first.time[i]).toBeGreaterThan(first.time[i - 1]);
        }
      }

      // Near-monotonic distance (5% noise tolerated)
      if (first.distance && first.distance.length > 1) {
        for (let i = 1; i < first.distance.length; i++) {
          expect(first.distance[i]).toBeGreaterThanOrEqual(first.distance[i - 1] * 0.95);
        }
      }

      // Realistic HR when present
      first.heartrate?.forEach((hr) => {
        expect(hr).toBeGreaterThanOrEqual(60);
        expect(hr).toBeLessThanOrEqual(200);
      });
    });
  });
});
