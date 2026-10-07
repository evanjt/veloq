/**
 * Scenario: the 3D map swaps its basemap style while nothing is selected, or
 * while the elevation chart is being scrubbed.
 *
 * Expected behaviour: the style the swap builds still names the route, the
 * start/end markers and the scrub marker, so a later route or scrub finds
 * its source.
 */
import { buildStyleOverlayScript } from '@/features/maps/lib/htmlBuilders';

type Overlays = {
  sources: Record<string, unknown>;
  layers: { id: string; layout: { visibility: string } }[];
};

const overlays = (coords: number[][], color = '#112233'): Overlays =>
  new Function(`${buildStyleOverlayScript()}; return veloqOverlays(arguments[0], arguments[1]);`)(
    coords,
    color
  ) as Overlays;

describe('buildStyleOverlayScript', () => {
  it('names the route, marker and scrub sources when there is no route', () => {
    const { sources, layers } = overlays([]);

    expect(Object.keys(sources).sort()).toEqual(['highlight-point', 'route', 'start-end-markers']);
    const visible = layers.filter((l) => l.layout.visibility === 'visible');
    expect(visible).toEqual([]);
    expect(layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['route-line', 'start-end-fill', 'highlight-border', 'highlight-fill'])
    );
  });

  it('shows the route layers and keeps the scrub marker hidden when there is a route', () => {
    const { sources, layers } = overlays([
      [7, 46],
      [7.1, 46.1],
    ]);

    const route = sources['route'] as { data: { features: unknown[] } };
    expect(route.data.features).toHaveLength(1);
    const vis = Object.fromEntries(layers.map((l) => [l.id, l.layout.visibility]));
    expect(vis['route-line']).toBe('visible');
    expect(vis['start-end-border']).toBe('visible');
    expect(vis['highlight-fill']).toBe('none');
    expect(vis['highlight-border']).toBe('none');
  });
});
