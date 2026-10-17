import { MAP_ACTIVITY_GROUPS } from '@/features/settings/components/MapsSection';
import { groupStyleState, groupTerrainState } from '@/features/settings/lib/mapStyleGroupState';

const types = (key: string) => MAP_ACTIVITY_GROUPS.find((group) => group.key === key)!.types;

describe('group style state', () => {
  it('shows Mixed for Strength and Other when only Workout, WeightTraining, Yoga and Other are satellite', () => {
    const saved = {
      Workout: 'satellite',
      WeightTraining: 'satellite',
      Yoga: 'satellite',
      Other: 'satellite',
    } as const;
    expect(groupStyleState(types('Strength'), saved)).toEqual({ mixed: true });
    expect(groupStyleState(types('Other'), saved)).toEqual({ mixed: true });
  });

  it('shows Mixed for Foot when only Hike is satellite', () => {
    expect(groupStyleState(types('Foot'), { Hike: 'satellite' })).toEqual({ mixed: true });
  });

  it('shows Default when every entry is missing', () => {
    expect(groupStyleState(types('Foot'), {})).toEqual({ mixed: false, value: 'default' });
  });

  it('shows the style when every member holds the same explicit style', () => {
    const saved = Object.fromEntries(types('Foot').map((tp) => [tp, 'dark']));
    expect(groupStyleState(types('Foot'), saved)).toEqual({ mixed: false, value: 'dark' });
  });

  it('keeps a missing entry distinct from an explicit one', () => {
    expect(groupStyleState(types('Foot'), { Walk: 'light' })).toEqual({ mixed: true });
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
  it('shows Mixed when Walk is off and Hike is always', () => {
    const saved = { Walk: 'off', Hike: 'always' } as const;
    expect(groupTerrainState(types('Foot'), saved, 'off')).toEqual({ mixed: true });
    expect(groupTerrainState(types('Foot'), saved, 'smart')).toEqual({ mixed: true });
  });

  it('resolves a missing Walk through the global mode before comparing', () => {
    expect(groupTerrainState(types('Foot'), { Hike: 'always' }, 'smart')).toEqual({
      mixed: true,
    });
  });

  it('shows one mode when missing and explicit entries resolve to it', () => {
    expect(groupTerrainState(types('Foot'), { Hike: 'smart' }, 'smart')).toEqual({
      mixed: false,
      value: 'smart',
    });
    expect(groupTerrainState(types('Foot'), {}, 'always')).toEqual({
      mixed: false,
      value: 'always',
    });
  });

  it('is independent of the style column', () => {
    expect(groupStyleState(types('Foot'), {})).toEqual({ mixed: false, value: 'default' });
    expect(groupTerrainState(types('Foot'), { Hike: 'always' }, 'off')).toEqual({
      mixed: true,
    });
  });
});
