import {
  getDateRanges,
  filterActivitiesByDateRange,
  calculateStats,
  type TimeRange,
} from '../lib/dateUtils';
import type { Activity } from '../types';

// Helper to create a mock activity
function createMockActivity(overrides: Partial<Activity>): Activity {
  return {
    id: 'test-id',
    name: 'Test Activity',
    type: 'Ride',
    start_date_local: '2024-06-15T10:00:00',
    moving_time: 3600,
    elapsed_time: 3900,
    distance: 30000,
    total_elevation_gain: 500,
    average_speed: 8.33,
    max_speed: 15,
    ...overrides,
  };
}

describe('getDateRanges', () => {
  // Use a fixed reference date for consistent tests
  const referenceDate = new Date(2024, 5, 15); // June 15, 2024 (Saturday)

  describe('week range', () => {
    it('should return last 7 days for current range', () => {
      const ranges = getDateRanges('week', referenceDate);

      // Current week: June 9-15
      expect(ranges.currentStart.getDate()).toBe(9);
      expect(ranges.currentStart.getMonth()).toBe(5); // June
      expect(ranges.currentEnd.getDate()).toBe(15);
    });

    it('should return previous 7 days for comparison', () => {
      const ranges = getDateRanges('week', referenceDate);

      // Previous week: June 2-8
      expect(ranges.previousStart.getDate()).toBe(2);
      expect(ranges.previousEnd.getDate()).toBe(8);
    });
  });

  describe('month range', () => {
    it('should return current month from 1st to today', () => {
      const ranges = getDateRanges('month', referenceDate);

      expect(ranges.currentStart.getDate()).toBe(1);
      expect(ranges.currentStart.getMonth()).toBe(5); // June
      expect(ranges.currentEnd.getDate()).toBe(15);
    });

    it('should return previous full month', () => {
      const ranges = getDateRanges('month', referenceDate);

      expect(ranges.previousStart.getDate()).toBe(1);
      expect(ranges.previousStart.getMonth()).toBe(4); // May
      expect(ranges.previousEnd.getDate()).toBe(31); // May has 31 days
      expect(ranges.previousEnd.getMonth()).toBe(4);
    });
  });

  describe('3m range', () => {
    it('should return last 3 months starting from 2 months ago', () => {
      const ranges = getDateRanges('3m', referenceDate);

      // Current: April 1 - June 15
      expect(ranges.currentStart.getMonth()).toBe(3); // April
      expect(ranges.currentStart.getDate()).toBe(1);
      expect(ranges.currentEnd.getMonth()).toBe(5); // June
    });

    it('should return previous 3 months for comparison', () => {
      const ranges = getDateRanges('3m', referenceDate);

      // Previous: Jan 1 - March 31
      expect(ranges.previousStart.getMonth()).toBe(0); // January
      expect(ranges.previousEnd.getMonth()).toBe(2); // March
    });
  });

  describe('6m range', () => {
    it('should return last 6 months', () => {
      const ranges = getDateRanges('6m', referenceDate);

      // Current: Jan 1 - June 15
      expect(ranges.currentStart.getMonth()).toBe(0); // January
      expect(ranges.currentEnd.getMonth()).toBe(5); // June
    });
  });

  describe('year range', () => {
    it('should return current year from Jan 1 to today', () => {
      const ranges = getDateRanges('year', referenceDate);

      expect(ranges.currentStart.getFullYear()).toBe(2024);
      expect(ranges.currentStart.getMonth()).toBe(0); // January
      expect(ranges.currentStart.getDate()).toBe(1);
      expect(ranges.currentEnd.getDate()).toBe(15);
      expect(ranges.currentEnd.getMonth()).toBe(5); // June
    });

    it('should return full previous year', () => {
      const ranges = getDateRanges('year', referenceDate);

      expect(ranges.previousStart.getFullYear()).toBe(2023);
      expect(ranges.previousStart.getMonth()).toBe(0);
      expect(ranges.previousStart.getDate()).toBe(1);
      expect(ranges.previousEnd.getFullYear()).toBe(2023);
      expect(ranges.previousEnd.getMonth()).toBe(11); // December
      expect(ranges.previousEnd.getDate()).toBe(31);
    });
  });

  describe('edge cases', () => {
    it('should handle year boundary (January reference)', () => {
      const janDate = new Date(2024, 0, 15); // Jan 15, 2024
      const ranges = getDateRanges('month', janDate);

      // Previous month should be December 2023
      expect(ranges.previousStart.getFullYear()).toBe(2023);
      expect(ranges.previousStart.getMonth()).toBe(11); // December
    });

    it('should handle leap year February', () => {
      const febDate = new Date(2024, 2, 15); // March 15, 2024 (2024 is leap year)
      const ranges = getDateRanges('month', febDate);

      // Previous month end (Feb 2024) should be 29th
      expect(ranges.previousEnd.getDate()).toBe(29);
      expect(ranges.previousEnd.getMonth()).toBe(1); // February
    });
  });
});

describe('filterActivitiesByDateRange', () => {
  const activities: Activity[] = [
    createMockActivity({ id: '1', start_date_local: '2024-06-01T10:00:00' }),
    createMockActivity({ id: '2', start_date_local: '2024-06-10T10:00:00' }),
    createMockActivity({ id: '3', start_date_local: '2024-06-15T10:00:00' }),
    createMockActivity({ id: '4', start_date_local: '2024-06-20T10:00:00' }),
    createMockActivity({ id: '5', start_date_local: '2024-07-01T10:00:00' }),
  ];

  it('should filter activities within date range', () => {
    const start = new Date(2024, 5, 5); // June 5
    const end = new Date(2024, 5, 18); // June 18

    const filtered = filterActivitiesByDateRange(activities, start, end);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(a => a.id)).toEqual(['2', '3']);
  });

  it('should include activities on boundary dates', () => {
    const start = new Date(2024, 5, 10); // June 10 at midnight
    const end = new Date(2024, 5, 15, 23, 59, 59); // June 15 end of day

    const filtered = filterActivitiesByDateRange(activities, start, end);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(a => a.id)).toEqual(['2', '3']);
  });

  it('should return empty array when no activities in range', () => {
    const start = new Date(2024, 7, 1); // August 1
    const end = new Date(2024, 7, 31); // August 31

    const filtered = filterActivitiesByDateRange(activities, start, end);

    expect(filtered).toHaveLength(0);
  });

  it('should handle empty activities array', () => {
    const start = new Date(2024, 5, 1);
    const end = new Date(2024, 5, 30);

    const filtered = filterActivitiesByDateRange([], start, end);

    expect(filtered).toHaveLength(0);
  });
});

describe('calculateStats', () => {
  it('should calculate stats from activities', () => {
    const activities: Activity[] = [
      createMockActivity({
        moving_time: 3600,
        distance: 30000,
        icu_training_load: 80,
      }),
      createMockActivity({
        moving_time: 7200,
        distance: 50000,
        icu_training_load: 120,
      }),
    ];

    const stats = calculateStats(activities);

    expect(stats.count).toBe(2);
    expect(stats.duration).toBe(10800); // 3600 + 7200
    expect(stats.distance).toBe(80000); // 30000 + 50000
    expect(stats.tss).toBe(200); // 80 + 120
  });

  it('should handle missing training load', () => {
    const activities: Activity[] = [
      createMockActivity({ icu_training_load: undefined }),
      createMockActivity({ icu_training_load: 100 }),
    ];

    const stats = calculateStats(activities);

    expect(stats.tss).toBe(100);
  });

  it('should return zeros for empty array', () => {
    const stats = calculateStats([]);

    expect(stats.count).toBe(0);
    expect(stats.duration).toBe(0);
    expect(stats.distance).toBe(0);
    expect(stats.tss).toBe(0);
  });

  it('should round TSS to nearest integer', () => {
    const activities: Activity[] = [
      createMockActivity({ icu_training_load: 33.3 }),
      createMockActivity({ icu_training_load: 33.3 }),
      createMockActivity({ icu_training_load: 33.3 }),
    ];

    const stats = calculateStats(activities);

    expect(stats.tss).toBe(100); // 99.9 rounds to 100
  });
});
