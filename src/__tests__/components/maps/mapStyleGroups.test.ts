import { MAP_ACTIVITY_GROUPS } from '@/features/settings/components/MapsSection';
import { SPORT_FAMILY_MEMBERS } from '@/shared/native/sportTaxonomy.generated';

describe('map style groups', () => {
  it('cover the same sports in the same families as the map filter', () => {
    for (const [family, types] of Object.entries(SPORT_FAMILY_MEMBERS)) {
      const settings = MAP_ACTIVITY_GROUPS.find((group) => group.key === family);
      expect(settings?.types).toEqual([...types]);
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
});
