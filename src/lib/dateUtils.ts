import type { Activity } from '@/types';

export type TimeRange = 'week' | 'month' | '3m' | '6m' | 'year';

export interface DateRanges {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

export function getDateRanges(range: TimeRange, referenceDate: Date = new Date()): DateRanges {
  const now = referenceDate;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'week': {
      // Current week (last 7 days)
      const currentStart = new Date(today);
      currentStart.setDate(currentStart.getDate() - 6);
      const currentEnd = today;
      // Previous week (7-14 days ago)
      const previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 7);
      const previousEnd = new Date(currentStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'month': {
      // Current month
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentEnd = today;
      // Previous month
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '3m': {
      // Last 3 months
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const currentEnd = today;
      // Previous 3 months
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 2, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '6m': {
      // Last 6 months
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const currentEnd = today;
      // Previous 6 months
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 5, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'year': {
      // This year
      const currentStart = new Date(now.getFullYear(), 0, 1);
      const currentEnd = today;
      // Last year
      const previousStart = new Date(now.getFullYear() - 1, 0, 1);
      const previousEnd = new Date(now.getFullYear() - 1, 11, 31);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
  }
}

export function filterActivitiesByDateRange(
  activities: Activity[],
  start: Date,
  end: Date
): Activity[] {
  return activities.filter(a => {
    const date = new Date(a.start_date_local);
    return date >= start && date <= end;
  });
}

export function calculateStats(activities: Activity[]) {
  const count = activities.length;
  const duration = activities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
  const distance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
  const tss = Math.round(activities.reduce((sum, a) => sum + (a.icu_training_load || 0), 0));
  return { count, duration, distance, tss };
}
