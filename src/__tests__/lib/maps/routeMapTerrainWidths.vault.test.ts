/**
 * Scenario: the route screen's overlay lines are drawn over terrain.
 * Expected behaviour: every line width is the flat width times the terrain
 * scale, and a flat map is unchanged.
 */
import { buildRouteLayers } from '@/features/routes/components/routeMapLayerSpecs';
import { MAP_3D_SCALE } from '@/features/maps';
import { mapPalette } from '@/theme';

const palette = mapPalette('light');
const args = { palette, routeContext: false, fadedFilter: undefined, includeRoute: true };

const widths = (terrain?: boolean) =>
  Object.fromEntries(
    buildRouteLayers({ ...args, ...(terrain === undefined ? {} : { terrain }) })
      .filter((layer) => layer.type === 'line')
      .map((layer) => [layer.id, (layer.paint as Record<string, unknown>)['line-width']])
  );

describe('route map line widths over terrain', () => {
  it('draws every line at the terrain scale of its flat width', () => {
    const flat = widths(false);
    const tilted = widths(true);
    expect(Object.keys(flat).length).toBeGreaterThan(3);
    for (const [id, width] of Object.entries(flat)) {
      expect(tilted[id]).toBeCloseTo((width as number) * MAP_3D_SCALE);
    }
  });

  it('leaves the flat widths as they were when no flag is given', () => {
    expect(widths()).toEqual(widths(false));
    expect(widths(false)['route-line']).toBe(4);
  });
});
