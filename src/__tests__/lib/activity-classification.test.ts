import {
  sortByDateId,
  getActivityColor,
  getActivityIcon,
  isPaceSport,
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
  // The name says what every caller asks: pace or speed. A walk is a pace, so
  // it belongs here, and it is not a run.
  it('classifies the sports shown in pace', () => {
    for (const type of ['Run', 'VirtualRun', 'Walk', 'Hike', 'TrailRun', 'Treadmill'] as const) {
      expect(isPaceSport(type)).toBe(true);
    }
    for (const type of ['Ride', 'Swim', 'Workout'] as const) {
      expect(isPaceSport(type)).toBe(false);
    }
  });

  // The six the engine's fitness gain counts as cycling (`objects/fitness.rs`).
  // `EBikeRide` is in its FTP list and not its gain list, and is not asserted
  // either way until the taxonomy has one owner.
  it('classifies every cycling type the engine counts', () => {
    for (const type of [
      'Ride',
      'VirtualRide',
      'MountainBikeRide',
      'GravelRide',
      'Handcycle',
      'Velomobile',
    ] as const) {
      expect(isCyclingActivity(type)).toBe(true);
    }
    for (const type of ['Run', 'Swim', 'Walk', 'Rowing'] as const) {
      expect(isCyclingActivity(type)).toBe(false);
    }
    expect(isCyclingActivity('Unicycle' as ActivityType)).toBe(false);
    expect(isCyclingActivity('' as ActivityType)).toBe(false);
  });
});
