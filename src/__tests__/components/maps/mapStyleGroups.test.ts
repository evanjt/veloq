import { ACTIVITY_CATEGORIES } from '@/features/maps/lib/activityCategories';
import { MAP_ACTIVITY_GROUPS } from '@/features/settings/components/MapsSection';
import { SPORT_FAMILY_MEMBERS, type SportFamily } from '@/shared/native/sportTaxonomy.generated';

describe('map style groups', () => {
  it('cover the same sports in the same families as the map filter', () => {
    for (const [category, filter] of Object.entries(ACTIVITY_CATEGORIES)) {
      const settings = MAP_ACTIVITY_GROUPS.find((group) => group.key === category);
      expect(settings?.types).toEqual(filter.types);
    }

    const allTypes = MAP_ACTIVITY_GROUPS.flatMap((group) => group.types);
    expect(new Set(allTypes).size).toBe(allTypes.length);
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Winter')?.types).toContain(
      'Snowshoe'
    );
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Water')?.types).toContain(
      'StandUpPaddling'
    );
    expect(MAP_ACTIVITY_GROUPS.find((group) => group.key === 'Other')?.types).toContain('Squash');
  });

  it('uses the engine families for every map filter category', () => {
    for (const [family, types] of Object.entries(SPORT_FAMILY_MEMBERS)) {
      expect(ACTIVITY_CATEGORIES[family as SportFamily].types).toEqual([...types]);
    }
  });
});
