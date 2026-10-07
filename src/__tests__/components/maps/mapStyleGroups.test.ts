import { ACTIVITY_CATEGORIES } from '@/features/maps/lib/activityCategories';
import { MAP_ACTIVITY_GROUPS } from '@/features/settings/components/MapsSection';
import { SPORT_DISPLAY_GROUPS } from '@/shared/native/sportTaxonomy.generated';

describe('map style groups', () => {
  it('cover the same sports in the same groups as the map filter', () => {
    for (const [category, filter] of Object.entries(ACTIVITY_CATEGORIES)) {
      const settings = MAP_ACTIVITY_GROUPS.find((group) => group.key === category);
      expect(settings?.types).toEqual(filter.types);
    }

    const allTypes = MAP_ACTIVITY_GROUPS.flatMap((group) => group.types);
    expect(new Set(allTypes).size).toBe(allTypes.length);
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Hike')?.types).toContain('Snowshoe');
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Water')?.types).toContain(
      'StandUpPaddling'
    );
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Racket')?.types).toContain('Squash');
  });

  it('uses the engine display groups for every map filter category', () => {
    for (const [category, types] of Object.entries(SPORT_DISPLAY_GROUPS)) {
      expect(ACTIVITY_CATEGORIES[category].types).toEqual([...types]);
    }
  });
});
