/**
 * Scenario: the activity map's fullscreen view can be tilted over terrain, and
 * its section portions and matched route are drawn by layer builders that take
 * the same terrain flag as the inline map.
 *
 * Expected behaviour: on a tilted base the fullscreen lines are drawn at
 * `MAP_3D_SCALE` of their flat widths, as the inline map draws its own. On a
 * flat base they keep their flat widths.
 */

import {
  buildFullscreenMatchedRouteLayers,
  buildFullscreenSectionLayers,
} from '@/features/maps/components/activityMapLayerSpecs';
import { MAP_3D_SCALE } from '@/features/maps/lib/mapLineWidths';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { mapPalette } from '@/theme';

const palette = mapPalette('light');

function lineWidth(layers: MapLayerSpec[], id: string): number {
  const width = (layers.find((layer) => layer.id === id)?.paint as Record<string, unknown>)?.[
    'line-width'
  ];
  if (typeof width !== 'number') throw new Error(`no numeric line-width on ${id}`);
  return width;
}

describe('fullscreen section and matched-route lines over terrain', () => {
  it.each(['fullscreen-portion-casing', 'fullscreen-portion-line'])(
    'draws %s at the 3D width on a tilted base',
    (id) => {
      const flat = buildFullscreenSectionLayers(true, palette, false);
      const tilted = buildFullscreenSectionLayers(true, palette, true);

      expect(lineWidth(tilted, id)).toBeCloseTo(lineWidth(flat, id) * MAP_3D_SCALE);
    }
  );

  it('draws the section portions at their flat widths on a flat base', () => {
    const flat = buildFullscreenSectionLayers(true, palette);

    expect(lineWidth(flat, 'fullscreen-portion-casing')).toBe(6);
    expect(lineWidth(flat, 'fullscreen-portion-line')).toBe(4);
  });

  it('draws the matched route at the 3D width on a tilted base', () => {
    const flat = buildFullscreenMatchedRouteLayers(true, palette, false);
    const tilted = buildFullscreenMatchedRouteLayers(true, palette, true);

    expect(lineWidth(tilted, 'fullscreen-overlay-line')).toBeCloseTo(
      lineWidth(flat, 'fullscreen-overlay-line') * MAP_3D_SCALE
    );
  });
});
