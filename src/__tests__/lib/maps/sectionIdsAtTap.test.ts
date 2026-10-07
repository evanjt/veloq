import { sectionIdsAtTap } from '@/features/maps/lib/sectionIdsAtTap';
import { SECTIONS_LINE_LAYER_ID } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapFeatureHit } from '@/features/maps/components/MapSurface';

function hit(id: unknown, layerId = SECTIONS_LINE_LAYER_ID): MapFeatureHit {
  return { layerId, id: null, properties: { id }, geometry: null };
}

describe('sectionIdsAtTap', () => {
  it('keeps one section when its line contributes duplicate hits', () => {
    expect(sectionIdsAtTap([hit('ridge'), hit('ridge')])).toEqual(['ridge']);
  });

  it('keeps distinct sections in page order', () => {
    expect(sectionIdsAtTap([hit('ridge'), hit('canal'), hit('ridge')])).toEqual(['ridge', 'canal']);
  });

  it('ignores unrelated layers and invalid ids', () => {
    expect(sectionIdsAtTap([hit('other', 'activity'), hit(42), hit(null)])).toEqual([]);
  });
});
