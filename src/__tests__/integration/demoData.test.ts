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
          expect(zone).toBe('greyZone');
        } else if (day.tsb < 25) {
          expect(zone).toBe('fresh');
        } else {
          expect(zone).toBe('transition');
        }
      });
    });
  });

  describe('Activity Data Pipeline', () => {
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

  describe('Chart Data Preparation', () => {
    it('combined sorting and TSB calculation pipeline produces valid ordered output', () => {
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
    it('generates monotonically increasing time and distance streams', () => {
      const activity = demoActivities.find((a: ApiActivity) => a.distance && a.distance > 0);
      expect(activity).toBeDefined();
      if (!activity) return;

      const streams = getActivityStreams(activity.id);
      expect(streams).not.toBeNull();
      if (!streams) return;

      if (streams.time && streams.time.length > 1) {
        for (let i = 1; i < streams.time.length; i++) {
          expect(streams.time[i]).toBeGreaterThan(streams.time[i - 1]);
        }
      }
      if (streams.distance && streams.distance.length > 1) {
        for (let i = 1; i < streams.distance.length; i++) {
          expect(streams.distance[i]).toBeGreaterThanOrEqual(streams.distance[i - 1] * 0.95);
        }
      }
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
    it('should generate 20 stress test activities with unique IDs', () => {
      const stressActivities = demoActivities.filter((a) => a.id.startsWith('demo-stress-'));
      expect(stressActivities.length).toBe(20);
      const unique = new Set(stressActivities.map((a) => a.id));
      expect(unique.size).toBe(stressActivities.length);
    });
  });

  describe('Deterministic Data Generation', () => {
    // Filter out stable test and stress test activities for date-based ID tests
    const dateBasedActivities = demoActivities.filter(
      (a: ApiActivity) => !a.id.startsWith('demo-test-') && !a.id.startsWith('demo-stress-')
    );

    it('activity IDs use deterministic date-based format and are globally unique', () => {
      const idPattern = /^demo-\d{4}-\d{2}-\d{2}-\d+$/;
      dateBasedActivities.forEach((activity: ApiActivity) => {
        expect(activity.id).toMatch(idPattern);
      });
      const ids = demoActivities.map((a: ApiActivity) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('wellness data ends at reference date', () => {
      const lastWellnessDate = demoWellness[demoWellness.length - 1].id;
      expect(lastWellnessDate).toBe(DEMO_REFERENCE_DATE);
    });

    it('streams are reproducible for the same activity', () => {
      const activity = demoActivities[0];
      expect(activity).toBeDefined();
      if (!activity) return;

      const streams1 = getActivityStreams(activity.id);
      const streams2 = getActivityStreams(activity.id);

      expect(streams1).not.toBeNull();
      expect(streams2).not.toBeNull();
      if (!streams1 || !streams2) return;

      expect(streams1.time).toEqual(streams2.time);
      expect(streams1.heartrate).toEqual(streams2.heartrate);
      expect(streams1.distance).toEqual(streams2.distance);
    });
  });
});
