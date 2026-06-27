import {
  sortByDateId,
  getActivityColor,
  getActivityIcon,
  isRunningActivity,
  isCyclingActivity,
} from '@/features/activity/lib/activityUtils';

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
  it('maps activity types to their color, falling back to zinc for unknown', () => {
    const cases: [Parameters<typeof getActivityColor>[0], string][] = [
      ['Ride', '#3B82F6'],
      ['VirtualRide', '#3B82F6'],
      ['VirtualRun', '#10B981'],
      ['SomeUnknownActivity' as any, '#71717A'],
    ];
    for (const [type, color] of cases) {
      expect(getActivityColor(type)).toBe(color);
    }
  });

  it('maps activity types to their icon, falling back to heart-pulse for unknown', () => {
    const cases: [Parameters<typeof getActivityIcon>[0], string][] = [
      ['Ride', 'bike'],
      ['SomeUnknownActivity' as any, 'heart-pulse'],
    ];
    for (const [type, icon] of cases) {
      expect(getActivityIcon(type)).toBe(icon);
    }
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
