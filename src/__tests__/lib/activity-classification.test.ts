import {
  sortByDateId,
  getActivityColor,
  getActivityIcon,
  isRunningActivity,
  isCyclingActivity,
} from '@/features/activity/lib/activityUtils';
import { activityTypeColors } from '@/theme/colors';
import type { ActivityType } from '@/types';

describe('sortByDateId', () => {
  it('sorts by date id without mutating the source, and handles empty input', () => {
    const items = [
      { id: '2024-01-15', value: 3 },
      { id: '2024-01-10', value: 1 },
      { id: '2024-01-20', value: 4 },
      { id: '2024-01-12', value: 2 },
    ];
    const originalOrder = items.map((i) => i.id);

    const sorted = sortByDateId(items);

    expect(sorted.map((i) => i.id)).toEqual([
      '2024-01-10',
      '2024-01-12',
      '2024-01-15',
      '2024-01-20',
    ]);
    expect(items.map((i) => i.id)).toEqual(originalOrder);
    expect(sortByDateId([])).toEqual([]);
  });
});

describe('icon & color lookup', () => {
  it('falls back to the Other colour for an unmapped activity type', () => {
    expect(getActivityColor('SomeUnknownActivity' as ActivityType)).toBe(activityTypeColors.Other);
  });

  it('falls back to heart-pulse for an unmapped activity type', () => {
    expect(getActivityIcon('SomeUnknownActivity')).toBe('heart-pulse');
  });
});

describe('type classification', () => {
  it('classifies running activities', () => {
    for (const type of ['Run', 'VirtualRun', 'Walk', 'Hike', 'TrailRun', 'Treadmill'] as const) {
      expect(isRunningActivity(type)).toBe(true);
    }
    for (const type of ['Ride', 'Swim', 'Workout'] as const) {
      expect(isRunningActivity(type)).toBe(false);
    }
  });

  it('classifies cycling activities', () => {
    for (const type of ['Ride', 'VirtualRide'] as const) {
      expect(isCyclingActivity(type)).toBe(true);
    }
    for (const type of ['Run', 'Swim', 'Walk'] as const) {
      expect(isCyclingActivity(type)).toBe(false);
    }
  });
});
