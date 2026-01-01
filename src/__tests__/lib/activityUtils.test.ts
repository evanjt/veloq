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

  it('handles single item array', () => {
    const items = [{ id: '2024-01-15', value: 1 }];
    const result = sortByDateId(items);
    expect(result).toEqual(items);
  });

  it('handles already sorted array', () => {
    const items = [
      { id: '2024-01-10', value: 1 },
      { id: '2024-01-15', value: 2 },
      { id: '2024-01-20', value: 3 },
    ];

    const sorted = sortByDateId(items);

    expect(sorted.map((i) => i.id)).toEqual(['2024-01-10', '2024-01-15', '2024-01-20']);
  });

  it('handles reverse sorted array', () => {
    const items = [
      { id: '2024-01-20', value: 3 },
      { id: '2024-01-15', value: 2 },
      { id: '2024-01-10', value: 1 },
    ];

    const sorted = sortByDateId(items);

    expect(sorted.map((i) => i.id)).toEqual(['2024-01-10', '2024-01-15', '2024-01-20']);
  });

  it('handles dates across years', () => {
    const items = [
      { id: '2024-01-15', value: 3 },
      { id: '2023-12-20', value: 2 },
      { id: '2022-06-10', value: 1 },
    ];

    const sorted = sortByDateId(items);

    expect(sorted.map((i) => i.id)).toEqual(['2022-06-10', '2023-12-20', '2024-01-15']);
  });

  it('preserves object properties', () => {
    const items = [
      { id: '2024-01-15', name: 'B', extra: { nested: true } },
      { id: '2024-01-10', name: 'A', extra: { nested: false } },
    ];

    const sorted = sortByDateId(items);

    expect(sorted[0]).toEqual({ id: '2024-01-10', name: 'A', extra: { nested: false } });
    expect(sorted[1]).toEqual({ id: '2024-01-15', name: 'B', extra: { nested: true } });
  });
});

describe('getActivityColor', () => {
  it('returns correct color for Ride', () => {
    expect(getActivityColor('Ride')).toBe('#3B82F6'); // Blue-500 (NO orange)
  });

  it('returns correct color for Run', () => {
    expect(getActivityColor('Run')).toBe('#10B981'); // Emerald-500
  });

  it('returns correct color for Swim', () => {
    expect(getActivityColor('Swim')).toBe('#06B6D4'); // Cyan-500
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

  it('returns run icon for Run', () => {
    expect(getActivityIcon('Run')).toBe('run');
  });

  it('returns swim icon for Swim', () => {
    expect(getActivityIcon('Swim')).toBe('swim');
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
