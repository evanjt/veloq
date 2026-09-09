/**
 * Scenario: the feed's sport chips filtered against four hand-written lists, so
 * an activity whose type was in none of them could not be reached by any chip.
 * Measured against a real ten-year library: 66 activities of 1,590, and 53 of
 * those were open-water swims while the app showed a Swimming chip.
 *
 * Expected behaviour: three sport buckets claim the types they know, and Other
 * is everything they do not, so a sport the athlete takes up next year is
 * filterable the day it syncs rather than the day someone adds the string.
 */

import {
  FEED_GROUPS,
  feedGroupFor,
  matchesFeedGroup,
} from '@/features/activity/lib/feedActivityGroups';
import { SPORT_FAMILIES } from '@/shared/native/sportTaxonomy.generated';

/** The nineteen types the measured account carries. */
const ACCOUNT_TYPES = [
  'Ride',
  'VirtualRide',
  'MountainBikeRide',
  'GravelRide',
  'EBikeRide',
  'Run',
  'VirtualRun',
  'TrailRun',
  'Swim',
  'OpenWaterSwim',
  'Walk',
  'Hike',
  'Workout',
  'WeightTraining',
  'Rowing',
  'Snowshoe',
  'AlpineSki',
  'Tennis',
  'Pilates',
];

describe('the feed sport chips', () => {
  it('offers the same four groups the chips render', () => {
    expect(FEED_GROUPS).toEqual(['Cycling', 'Running', 'Swimming', 'Other']);
  });

  it('lands every type this account carries in exactly one group', () => {
    for (const type of ACCOUNT_TYPES) {
      const groups = FEED_GROUPS.filter((g) => matchesFeedGroup(g, type));
      expect(groups).toHaveLength(1);
      expect(groups[0]).toBe(feedGroupFor(type));
    }
  });

  it('reaches every activity, which is what the four lists did not', () => {
    const reachable = ACCOUNT_TYPES.filter((type) =>
      FEED_GROUPS.some((g) => matchesFeedGroup(g, type))
    );

    expect(reachable).toHaveLength(ACCOUNT_TYPES.length);
  });

  it('puts an open-water swim under Swimming, where the athlete looks for it', () => {
    expect(feedGroupFor('OpenWaterSwim')).toBe('Swimming');
    expect(feedGroupFor('Swim')).toBe('Swimming');
  });

  it.each([
    ['Ride', 'Cycling'],
    ['EBikeRide', 'Cycling'],
    ['TrackRide', 'Cycling'],
    ['Cyclocross', 'Cycling'],
    ['Handcycle', 'Cycling'],
    ['TrailRun', 'Running'],
    ['Treadmill', 'Running'],
    ['Walk', 'Other'],
    ['WeightTraining', 'Other'],
    ['Snowshoe', 'Other'],
    ['AlpineSki', 'Other'],
    ['Tennis', 'Other'],
    ['Pilates', 'Other'],
    ['RockClimbing', 'Other'],
  ])('puts %s under %s', (type, group) => {
    expect(feedGroupFor(type)).toBe(group);
  });

  it('claims every sport the engine names, in the family the engine gives it', () => {
    for (const type of SPORT_FAMILIES.cycling) expect(feedGroupFor(type)).toBe('Cycling');
    for (const type of SPORT_FAMILIES.running) expect(feedGroupFor(type)).toBe('Running');
    for (const type of SPORT_FAMILIES.swimming) expect(feedGroupFor(type)).toBe('Swimming');
    for (const type of SPORT_FAMILIES.walking) expect(feedGroupFor(type)).toBe('Other');
  });

  it('claims a sport nobody has written down yet', () => {
    expect(feedGroupFor('Kitesurf')).toBe('Other');
    expect(matchesFeedGroup('Other', 'Kitesurf')).toBe(true);
  });

  it('does not let a prefix claim a longer type', () => {
    // `Ride` must not swallow `RideTheWind`, and `Run` must not take `Rungby`.
    expect(feedGroupFor('RideTheWind')).toBe('Other');
    expect(feedGroupFor('Rungby')).toBe('Other');
  });

  it('reads an empty or missing type as Other rather than nothing', () => {
    expect(feedGroupFor('')).toBe('Other');
    expect(matchesFeedGroup('Other', '')).toBe(true);
    expect(matchesFeedGroup('Cycling', '')).toBe(false);
  });
});
