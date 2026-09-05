import {
  sortByDateId,
  getActivityColor,
  getActivityIcon,
  isPaceSport,
  isCyclingActivity,
  isSwimmingActivity,
  measuresPower,
} from '@/features/activity/lib/activityUtils';
import { SPORT_FAMILIES } from '@/shared/native/sportTaxonomy.generated';
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

  // Every cycling type the engine's taxonomy names, read from the generated
  // copy so a sport added in Rust is asserted here without a hand edit.
  it('classifies every cycling type the engine counts', () => {
    expect(SPORT_FAMILIES.cycling).toContain('EBikeRide');
    for (const type of SPORT_FAMILIES.cycling) {
      expect(isCyclingActivity(type as ActivityType)).toBe(true);
    }
    for (const type of ['Run', 'Swim', 'Walk', 'Rowing'] as const) {
      expect(isCyclingActivity(type)).toBe(false);
    }
    expect(isCyclingActivity('Unicycle' as ActivityType)).toBe(false);
    expect(isCyclingActivity('' as ActivityType)).toBe(false);
  });

  // Power is a wider question than cycling: a rower's effort is watts too,
  // and the activity chart already opens a row on power.
  it('says which sports measure power', () => {
    for (const type of SPORT_FAMILIES.cycling) {
      expect(measuresPower(type as ActivityType)).toBe(true);
    }
    expect(measuresPower('Rowing')).toBe(true);
    expect(measuresPower('VirtualRow')).toBe(true);
    for (const type of ['Run', 'Swim', 'Walk', 'Hike', 'Yoga'] as const) {
      expect(measuresPower(type)).toBe(false);
    }
    expect(measuresPower('' as ActivityType)).toBe(false);
  });

  it('reads pace membership from the same taxonomy', () => {
    for (const type of [...SPORT_FAMILIES.running, ...SPORT_FAMILIES.walking]) {
      expect(isPaceSport(type as ActivityType)).toBe(true);
    }
    for (const type of SPORT_FAMILIES.swimming) {
      expect(isSwimmingActivity(type as ActivityType)).toBe(true);
      expect(isPaceSport(type as ActivityType)).toBe(false);
    }
  });
});
