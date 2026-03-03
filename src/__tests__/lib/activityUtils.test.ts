import {
  sortByDateId,
  getActivityColor,
  getActivityIcon,
  isRunningActivity,
  isCyclingActivity,
} from '@/lib/utils/activityUtils';

describe('sortByDateId', () => {
  it('sorts items by date id in chronological order', () => {
    const items = [
      { id: '2024-01-15', value: 3 },
      { id: '2024-01-10', value: 1 },
      { id: '2024-01-20', value: 4 },
      { id: '2024-01-12', value: 2 },
    ];

    const sorted = sortByDateId(items);

    expect(sorted.map((i) => i.id)).toEqual([
      '2024-01-10',
      '2024-01-12',
      '2024-01-15',
      '2024-01-20',
    ]);
  });

  it('does not mutate the original array', () => {
    const items = [
      { id: '2024-01-15', value: 2 },
      { id: '2024-01-10', value: 1 },
    ];
    const originalOrder = [...items.map((i) => i.id)];

    sortByDateId(items);

    expect(items.map((i) => i.id)).toEqual(originalOrder);
  });

  it('handles empty array', () => {
    const result = sortByDateId([]);
    expect(result).toEqual([]);
  });
});

describe('getActivityColor', () => {
  it('returns correct color for Ride', () => {
    expect(getActivityColor('Ride')).toBe('#3B82F6'); // Blue-500 (NO orange)
  });

  it('returns default color for unknown activity', () => {
    expect(getActivityColor('SomeUnknownActivity' as any)).toBe('#71717A'); // Zinc-500
  });

  it('returns correct color for virtual activities', () => {
    expect(getActivityColor('VirtualRide')).toBe('#3B82F6'); // Blue-500
    expect(getActivityColor('VirtualRun')).toBe('#10B981'); // Emerald-500
  });
});

describe('getActivityIcon', () => {
  it('returns bike icon for Ride', () => {
    expect(getActivityIcon('Ride')).toBe('bike');
  });

  it('returns default icon for unknown activity', () => {
    expect(getActivityIcon('SomeUnknownActivity' as any)).toBe('heart-pulse');
  });
});

describe('isRunningActivity', () => {
  it('returns true for running activities', () => {
    expect(isRunningActivity('Run')).toBe(true);
    expect(isRunningActivity('VirtualRun')).toBe(true);
    expect(isRunningActivity('Walk')).toBe(true);
    expect(isRunningActivity('Hike')).toBe(true);
    expect(isRunningActivity('TrailRun')).toBe(true);
    expect(isRunningActivity('Treadmill')).toBe(true);
  });

  it('returns false for non-running activities', () => {
    expect(isRunningActivity('Ride')).toBe(false);
    expect(isRunningActivity('Swim')).toBe(false);
    expect(isRunningActivity('Workout')).toBe(false);
  });
});

describe('isCyclingActivity', () => {
  it('returns true for cycling activities', () => {
    expect(isCyclingActivity('Ride')).toBe(true);
    expect(isCyclingActivity('VirtualRide')).toBe(true);
  });

  it('returns false for non-cycling activities', () => {
    expect(isCyclingActivity('Run')).toBe(false);
    expect(isCyclingActivity('Swim')).toBe(false);
    expect(isCyclingActivity('Walk')).toBe(false);
  });
});
