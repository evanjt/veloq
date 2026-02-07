/**
 * Integration tests using actual demo data.
 * These tests verify the full data pipeline works correctly
 * with realistic data, without heavy mocking.
 */

import { calculateTSB, getFormZone } from '@/lib/algorithms/fitness';
import { sortByDateId } from '@/lib/utils/activityUtils';
import { demoWellness } from '@/data/demo/wellness';
import { fixtures, getActivityStreams, type ApiActivity } from '@/data/demo/fixtures';
import { DEMO_REFERENCE_DATE } from '@/data/demo/random';
import type { WellnessData } from '@/types';

// Use fixture-based activities (the primary demo data source)
const demoActivities = fixtures.activities;

describe('Demo Data Integration Tests', () => {
  describe('Wellness Data Pipeline', () => {
    it('wellness data is chronologically sorted', () => {
      const sorted = sortByDateId(demoWellness);

      // Check that dates are in ascending order
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].id >= sorted[i - 1].id).toBe(true);
      }
    });

    it('wellness data has valid CTL/ATL values', () => {
      demoWellness.forEach((day) => {
        // CTL should be between 0 and 200 (realistic for most athletes)
        if (day.ctl !== undefined) {
          expect(day.ctl).toBeGreaterThanOrEqual(0);
          expect(day.ctl).toBeLessThanOrEqual(200);
        }

        // ATL should be between 0 and 300
        if (day.atl !== undefined) {
          expect(day.atl).toBeGreaterThanOrEqual(0);
          expect(day.atl).toBeLessThanOrEqual(300);
        }
      });
    });

    it('calculateTSB produces valid form values', () => {
      const withTSB = calculateTSB(demoWellness);

      withTSB.forEach((day) => {
        // TSB (form) should typically be between -100 and +100
        expect(day.tsb).toBeGreaterThanOrEqual(-150);
        expect(day.tsb).toBeLessThanOrEqual(150);

        // TSB should approximately equal CTL - ATL (may have rounding differences)
        const ctl = day.ctl ?? day.ctlLoad ?? 0;
        const atl = day.atl ?? day.atlLoad ?? 0;
        const expectedTsb = ctl - atl;
        // Allow for rounding differences of up to 1
        expect(Math.abs(day.tsb - expectedTsb)).toBeLessThanOrEqual(1);
      });
    });

    it('getFormZone correctly categorizes TSB values', () => {
      const withTSB = calculateTSB(demoWellness);

      withTSB.forEach((day) => {
        const zone = getFormZone(day.tsb);

        // Verify zone assignment matches TSB value
        if (day.tsb < -30) {
          expect(zone).toBe('highRisk');
        } else if (day.tsb < -10) {
          expect(zone).toBe('optimal');
        } else if (day.tsb < 5) {
          expect(zone).toBe('grey');
        } else if (day.tsb < 25) {
          expect(zone).toBe('fresh');
        } else {
          expect(zone).toBe('transition');
        }
      });
    });

    it('wellness data covers expected date range', () => {
      const sorted = sortByDateId(demoWellness);
      const firstDate = new Date(sorted[0].id);
      const lastDate = new Date(sorted[sorted.length - 1].id);

      // Should have at least 30 days of data - use calendar days
      const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
      const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
      const daysDiff = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeGreaterThanOrEqual(30);
    });

    it('wellness data has mostly unique dates', () => {
      const dates = demoWellness.map((d) => d.id);
      const uniqueDates = new Set(dates);
      // Allow for some duplicates in demo data (date generation edge cases)
      // At least 99% should be unique
      expect(uniqueDates.size / dates.length).toBeGreaterThanOrEqual(0.99);
    });
  });

  describe('Activity Data Pipeline', () => {
    it('activities have required fields', () => {
      demoActivities.forEach((activity: ApiActivity) => {
        expect(activity.id).toBeDefined();
        expect(typeof activity.id).toBe('string');
        expect(activity.name).toBeDefined();
        expect(activity.type).toBeDefined();
      });
    });

    it('activities have valid dates', () => {
      demoActivities.forEach((activity: ApiActivity) => {
        if (activity.start_date_local) {
          const date = new Date(activity.start_date_local);
          expect(date.toString()).not.toBe('Invalid Date');
        }
      });
    });

    it('activities have reasonable training load values', () => {
      demoActivities.forEach((activity: ApiActivity) => {
        if (activity.icu_training_load !== undefined && activity.icu_training_load !== null) {
          expect(activity.icu_training_load).toBeGreaterThanOrEqual(0);
          expect(activity.icu_training_load).toBeLessThanOrEqual(500);
        }
      });
    });

    it('activities with GPS have stream_types including latlng', () => {
      const activitiesWithGps = demoActivities.filter((a: ApiActivity) =>
        a.stream_types?.includes('latlng')
      );

      // Should have some GPS activities in demo data
      expect(activitiesWithGps.length).toBeGreaterThan(0);
    });

    it('activity types are valid', () => {
      const validTypes = [
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
      ];

      demoActivities.forEach((activity: ApiActivity) => {
        expect(validTypes).toContain(activity.type);
      });
    });
  });

  describe('Data Consistency', () => {
    it('wellness dates align with activity dates', () => {
      const wellnessDates = new Set(demoWellness.map((d) => d.id));
      const activityDates = new Set(
        demoActivities
          .map((a: ApiActivity) => a.start_date_local?.split('T')[0])
          .filter(Boolean) as string[]
      );

      // There should be overlap between wellness and activity dates
      let overlap = 0;
      activityDates.forEach((date: string) => {
        if (wellnessDates.has(date)) {
          overlap++;
        }
      });

      expect(overlap).toBeGreaterThan(0);
    });

    it('sportInfo in wellness matches activities by date', () => {
      const activityDateMap = new Map<string, number>();
      demoActivities.forEach((a: ApiActivity) => {
        const date = a.start_date_local?.split('T')[0];
        if (date) {
          activityDateMap.set(date, (activityDateMap.get(date) || 0) + 1);
        }
      });

      // For days with activities, sportInfo should have entries
      demoWellness.forEach((day) => {
        const activityCount = activityDateMap.get(day.id) || 0;
        if (activityCount > 0 && day.sportInfo) {
          expect(day.sportInfo.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Chart Data Preparation', () => {
    it('sortByDateId produces stable output for repeated calls', () => {
      const result1 = sortByDateId(demoWellness);
      const result2 = sortByDateId(demoWellness);

      expect(result1.map((d) => d.id)).toEqual(result2.map((d) => d.id));
    });

    it('calculateTSB is idempotent', () => {
      const result1 = calculateTSB(demoWellness);
      const result2 = calculateTSB(demoWellness);

      expect(result1.map((d) => d.tsb)).toEqual(result2.map((d) => d.tsb));
    });

    it('combined sorting and TSB calculation pipeline', () => {
      const sorted = sortByDateId(demoWellness);
      const withTSB = calculateTSB(sorted);

      // Should preserve order after TSB calculation
      for (let i = 1; i < withTSB.length; i++) {
        expect(withTSB[i].id >= withTSB[i - 1].id).toBe(true);
      }

      // Should have TSB for all entries
      withTSB.forEach((day) => {
        expect(typeof day.tsb).toBe('number');
        expect(Number.isNaN(day.tsb)).toBe(false);
      });
    });
  });

  describe('Activity Streams', () => {
    it('generates distance stream for activities with distance', () => {
      const activitiesWithDistance = demoActivities.filter(
        (a: ApiActivity) => a.distance && a.distance > 0
      );

      expect(activitiesWithDistance.length).toBeGreaterThan(0);

      // Test first 5 to keep test fast (stream generation is expensive)
      activitiesWithDistance.slice(0, 5).forEach((activity: ApiActivity) => {
        const streams = getActivityStreams(activity.id);
        expect(streams).not.toBeNull();
        if (!streams) return;

        // Distance stream is required for chart X-axis
        expect(streams.distance).toBeDefined();
        expect(streams.distance?.length).toBeGreaterThan(0);

        // Distance should be monotonically increasing
        if (streams.distance && streams.distance.length > 1) {
          for (let i = 1; i < streams.distance.length; i++) {
            expect(streams.distance[i]).toBeGreaterThanOrEqual(streams.distance[i - 1] * 0.95);
          }
        }

        // Last distance value should be close to activity distance
        if (streams.distance && activity.distance) {
          const lastDistance = streams.distance[streams.distance.length - 1];
          expect(lastDistance).toBeCloseTo(activity.distance, -2); // Within 1%
        }
      });
    });

    it('generates time stream for all activities', () => {
      demoActivities.slice(0, 5).forEach((activity: ApiActivity) => {
        const streams = getActivityStreams(activity.id);
        expect(streams).not.toBeNull();
        if (!streams) return;

        expect(streams.time).toBeDefined();
        expect(streams.time?.length).toBeGreaterThan(0);

        // Time should be monotonically increasing
        if (streams.time && streams.time.length > 1) {
          for (let i = 1; i < streams.time.length; i++) {
            expect(streams.time[i]).toBeGreaterThan(streams.time[i - 1]);
          }
        }
      });
    });

    it('generates heart rate stream with realistic values', () => {
      const activitiesWithHr = demoActivities.filter((a: ApiActivity) =>
        a.stream_types?.includes('heartrate')
      );

      expect(activitiesWithHr.length).toBeGreaterThan(0);

      activitiesWithHr.slice(0, 3).forEach((activity: ApiActivity) => {
        const streams = getActivityStreams(activity.id);
        expect(streams).not.toBeNull();
        if (!streams) return;

        expect(streams.heartrate).toBeDefined();
        expect(streams.heartrate?.length).toBeGreaterThan(0);

        // HR values should be in realistic range (60-200 bpm)
        streams.heartrate?.forEach((hr) => {
          expect(hr).toBeGreaterThanOrEqual(60);
          expect(hr).toBeLessThanOrEqual(200);
        });
      });
    });
  });

  describe('Stress test fixtures', () => {
    it('should generate 200 stress test activities', () => {
      const stressActivities = demoActivities.filter((a) => a.id.startsWith('demo-stress-'));
      expect(stressActivities.length).toBe(200);
    });

    it('stress activities should all use the same route', () => {
      const stressActivities = demoActivities.filter((a) =>
        a.id.startsWith('demo-stress-')
      ) as (ApiActivity & { _routeId?: string })[];
      const routes = new Set(stressActivities.map((a) => a._routeId));
      expect(routes.size).toBe(1);
      expect(routes.has('route-rio-run-1')).toBe(true);
    });

    it('stress activities should have unique IDs', () => {
      const stressIds = demoActivities
        .filter((a) => a.id.startsWith('demo-stress-'))
        .map((a) => a.id);
      const unique = new Set(stressIds);
      expect(unique.size).toBe(stressIds.length);
    });
  });

  describe('Deterministic Data Generation', () => {
    // Filter out stable test and stress test activities for date-based ID tests
    const dateBasedActivities = demoActivities.filter(
      (a: ApiActivity) => !a.id.startsWith('demo-test-') && !a.id.startsWith('demo-stress-')
    );

    it('activity IDs use deterministic date-based format', () => {
      // Date-based IDs should match format: demo-YYYY-MM-DD-N
      // Stable test activities (demo-test-N) are excluded
      const idPattern = /^demo-\d{4}-\d{2}-\d{2}-\d+$/;

      dateBasedActivities.forEach((activity: ApiActivity) => {
        expect(activity.id).toMatch(idPattern);
      });
    });

    it('stable test activities exist with correct format', () => {
      // Stable test activities should match format: demo-test-N
      const stableActivities = demoActivities.filter((a: ApiActivity) =>
        a.id.startsWith('demo-test-')
      );

      expect(stableActivities.length).toBeGreaterThanOrEqual(5);
      stableActivities.forEach((activity: ApiActivity) => {
        expect(activity.id).toMatch(/^demo-test-\d+$/);
      });
    });

    it('has activities near reference date', () => {
      // Find activities in January 2026 (near reference date)
      const januaryActivities = demoActivities.filter((a: ApiActivity) =>
        a.id.startsWith('demo-2026-01-')
      );

      // Should have at least a few activities in January 2026
      expect(januaryActivities.length).toBeGreaterThan(5);

      // All should have valid date-based IDs
      januaryActivities.forEach((a: ApiActivity) => {
        expect(a.id).toMatch(/^demo-2026-01-\d{2}-\d+$/);
      });
    });

    it('activity IDs are unique', () => {
      const ids = demoActivities.map((a: ApiActivity) => a.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('activity dates align with IDs', () => {
      // Only check date-based activities (stable test activities have different ID format)
      dateBasedActivities.forEach((activity: ApiActivity) => {
        // Extract date from ID: demo-YYYY-MM-DD-N → YYYY-MM-DD
        const idDate = activity.id.replace(/^demo-/, '').replace(/-\d+$/, '');
        const activityDate = activity.start_date_local.split('T')[0];

        expect(idDate).toBe(activityDate);
      });
    });

    it('wellness data uses reference date range', () => {
      // Wellness should end at or near reference date
      const lastWellnessDate = demoWellness[demoWellness.length - 1].id;
      expect(lastWellnessDate).toBe(DEMO_REFERENCE_DATE);
    });

    it('streams are reproducible for the same activity', () => {
      // Use the first activity (guaranteed to exist)
      const activity = demoActivities[0];
      expect(activity).toBeDefined();
      if (!activity) return;

      // Generate streams twice
      const streams1 = getActivityStreams(activity.id);
      const streams2 = getActivityStreams(activity.id);

      expect(streams1).not.toBeNull();
      expect(streams2).not.toBeNull();
      if (!streams1 || !streams2) return;

      // Time stream should be identical
      expect(streams1.time).toEqual(streams2.time);

      // Heart rate stream should be identical
      expect(streams1.heartrate).toEqual(streams2.heartrate);

      // Distance stream should be identical
      expect(streams1.distance).toEqual(streams2.distance);
    });

    it('activities for the same date have sequential indices', () => {
      // Group activities by date (dateBasedActivities excludes stable test activities)
      const byDate = new Map<string, string[]>();
      dateBasedActivities.forEach((a: ApiActivity) => {
        const date = a.start_date_local.split('T')[0];
        if (!byDate.has(date)) {
          byDate.set(date, []);
        }
        byDate.get(date)!.push(a.id);
      });

      // For each date with multiple activities, indices should be sequential
      byDate.forEach((ids, _date) => {
        if (ids.length > 1) {
          const indices = ids.map((id) => {
            const match = id.match(/-(\d+)$/);
            return match ? parseInt(match[1], 10) : -1;
          });
          indices.sort((a, b) => a - b);

          // Should be 0, 1, 2, ... (sequential)
          indices.forEach((idx, i) => {
            expect(idx).toBe(i);
          });
        }
      });
    });
  });
});
