import { MAP_ACTIVITY_GROUPS } from '@/features/settings/components/MapsSection';
import { groupStyleState, groupTerrainState } from '@/features/settings/lib/mapStyleGroupState';

const types = (key: string) => MAP_ACTIVITY_GROUPS.find((group) => group.key === key)!.types;

describe('group style state', () => {
  it('shows Mixed for Gym and Other when only Workout, WeightTraining, Yoga and Other are satellite', () => {
    const saved = {
      Workout: 'satellite',
      WeightTraining: 'satellite',
      Yoga: 'satellite',
      Other: 'satellite',
    } as const;
    expect(groupStyleState(types('Gym'), saved)).toEqual({ mixed: true });
    expect(groupStyleState(types('Other'), saved)).toEqual({ mixed: true });
  });

  it('shows Mixed for Hike when only Snowshoe is satellite', () => {
    expect(groupStyleState(types('Hike'), { Snowshoe: 'satellite' })).toEqual({ mixed: true });
  });

  it('shows Default when every entry is missing', () => {
    expect(groupStyleState(types('Hike'), {})).toEqual({ mixed: false, value: 'default' });
  });

  it('shows the style when every member holds the same explicit style', () => {
    const saved = Object.fromEntries(types('Hike').map((tp) => [tp, 'dark']));
    expect(groupStyleState(types('Hike'), saved)).toEqual({ mixed: false, value: 'dark' });
  });

  it('keeps a missing entry distinct from an explicit one', () => {
    expect(groupStyleState(types('Hike'), { Hike: 'light' })).toEqual({ mixed: true });
  });

  it('reports a single-member group by its one value', () => {
    const [only] = MAP_ACTIVITY_GROUPS.filter((group) => group.types.length === 1);
    if (only) {
      expect(groupStyleState(only.types, { [only.types[0]]: 'dark' })).toEqual({
        mixed: false,
        value: 'dark',
      });
    }
    expect(groupStyleState(['Ride'], { Ride: 'dark' })).toEqual({ mixed: false, value: 'dark' });
    expect(groupStyleState(['Ride'], {})).toEqual({ mixed: false, value: 'default' });
  });
});

describe('group terrain state', () => {
  it('shows Mixed when Hike is off and Snowshoe is always', () => {
    const saved = { Hike: 'off', Snowshoe: 'always' } as const;
    expect(groupTerrainState(types('Hike'), saved, 'off')).toEqual({ mixed: true });
    expect(groupTerrainState(types('Hike'), saved, 'smart')).toEqual({ mixed: true });
  });

  it('resolves a missing Hike through the global mode before comparing', () => {
    expect(groupTerrainState(types('Hike'), { Snowshoe: 'always' }, 'smart')).toEqual({
      mixed: true,
    });
  });

  it('shows one mode when missing and explicit entries resolve to it', () => {
    expect(groupTerrainState(types('Hike'), { Snowshoe: 'smart' }, 'smart')).toEqual({
      mixed: false,
      value: 'smart',
    });
    expect(groupTerrainState(types('Hike'), {}, 'always')).toEqual({
      mixed: false,
      value: 'always',
    });
  });

  it('is independent of the style column', () => {
    expect(groupStyleState(types('Hike'), {})).toEqual({ mixed: false, value: 'default' });
    expect(groupTerrainState(types('Hike'), { Snowshoe: 'always' }, 'off')).toEqual({
      mixed: true,
    });
  });
});
