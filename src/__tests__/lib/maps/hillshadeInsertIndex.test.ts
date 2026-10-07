import {
  HILLSHADE_INSERT_INDEX_SCRIPT,
  TERRAIN_3D_CONFIG,
} from '@/features/maps/components/mapStyles';
import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';

type Layer = { id: string };
const hillshadeInsertIndex = new Function(
  `${HILLSHADE_INSERT_INDEX_SCRIPT}; return hillshadeInsertIndex;`
)() as (layers: Layer[], candidates: readonly string[]) => number;

const candidates = TERRAIN_3D_CONFIG.hillshadeInsertBeforeCandidates;

describe('hillshadeInsertIndex', () => {
  it('lands before the first road in the light style, not at its later building layer', () => {
    const layers = LIBERTY_STYLE.layers as unknown as Layer[];
    const idx = hillshadeInsertIndex(layers, candidates);
    const firstRoad = layers.findIndex((l) => l.id === 'tunnel_motorway_link_casing');
    const building = layers.findIndex((l) => l.id === 'building');
    expect(idx).toBeLessThanOrEqual(firstRoad);
    expect(idx).toBeLessThan(building);
  });

  it('takes the earliest candidate in layer order, whatever the candidate order', () => {
    const layers = [{ id: 'bg' }, { id: 'road_pier' }, { id: 'building' }];
    expect(hillshadeInsertIndex(layers, ['building', 'road_pier'])).toBe(1);
  });

  it('answers the layer count when no candidate is present', () => {
    expect(hillshadeInsertIndex([{ id: 'a' }, { id: 'b' }], candidates)).toBe(2);
    expect(hillshadeInsertIndex([], candidates)).toBe(0);
  });
});
