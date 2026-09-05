/**
 * Scenario: the teleport guard classified a sport by substring, so it was a
 * sixth list of what counts as cycling, and a velomobile or handcycle reached
 * the cycling ceiling only because unknown fell through to it.
 *
 * Expected behaviour: the guard reads the engine's taxonomy, and a sport the
 * taxonomy does not name still takes the most generous ceiling, since a guard
 * that is too strict drops real points.
 */

import { SPORT_FAMILIES } from '@/shared/native/sportTaxonomy.generated';
import {
  getMaxPlausibleSpeed,
  getSportCategory,
} from '@/features/recording/lib/sportCategoryDetector';
import type { ActivityType } from '@/types';

describe('the teleport guard sport category', () => {
  it('reads every family from the taxonomy', () => {
    for (const type of SPORT_FAMILIES.cycling) {
      expect(getSportCategory(type as ActivityType)).toBe('cycling');
    }
    for (const type of SPORT_FAMILIES.running) {
      expect(getSportCategory(type as ActivityType)).toBe('running');
    }
    for (const type of SPORT_FAMILIES.walking) {
      expect(getSportCategory(type as ActivityType)).toBe('walking');
    }
  });

  it('gives an unknown or empty sport the cycling ceiling rather than dropping its points', () => {
    expect(getSportCategory('Kitesurf')).toBe('cycling');
    expect(getSportCategory('' as ActivityType)).toBe('cycling');
    expect(getMaxPlausibleSpeed('Kitesurf')).toBe(getMaxPlausibleSpeed('Ride'));
  });

  it('does not let a substring decide', () => {
    // A treadmill is a run because the taxonomy says so, not because it
    // contains the letters. Nothing that merely contains `run` is running.
    expect(getSportCategory('Treadmill')).toBe('running');
    expect(getSportCategory('Runway' as ActivityType)).toBe('cycling');
    expect(getSportCategory('Walkabout' as ActivityType)).toBe('cycling');
  });

  it('orders the ceilings cycling above running above walking', () => {
    expect(getMaxPlausibleSpeed('Ride')).toBeGreaterThan(getMaxPlausibleSpeed('Run'));
    expect(getMaxPlausibleSpeed('Run')).toBeGreaterThan(getMaxPlausibleSpeed('Walk'));
  });
});
