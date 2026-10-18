/**
 * The direction a subject line is read in, drawn as chevrons along it.
 *
 * A section ridden both ways shows the direction the chart is on as a shape,
 * not a colour: forward and reverse are never two line colours on a map. The
 * chevrons sit on the subject line's own source, and reverse turns the same
 * symbols round rather than adding a source.
 */
import type { MapPalette } from '@/theme';
import type { MapImageSpec, MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { ENDPOINT_IMAGES } from '@/features/maps/lib/endpointLayers';
import { DIRECTION_ICON, DIRECTION_ICON_ID } from '@/features/maps/lib/mapIcons';

/** The images a surface showing both a track's endpoints and its direction registers. */
export const ENDPOINT_AND_DIRECTION_IMAGES: MapImageSpec[] = [...ENDPOINT_IMAGES, DIRECTION_ICON];

/** Pixels between chevrons along the line. */
export const DIRECTION_SPACING = 80;
// The icon is a 64 px square, so this draws a chevron 10 px tall.
const DIRECTION_ICON_SIZE = 0.25;
// The chevron's distance field falls about 8 alpha per image pixel, and the
// renderer scales the halo by the inverse icon size, so the drawn ring is
// about 4 times this value in screen pixels. Kept at or below 0.5 so the ring
// stays narrower than the 3 px arm beside it.
const DIRECTION_OUTLINE_WIDTH = 0.35;

/**
 * The chevron is the inverse of the line it sits on: a casing glyph, which
 * holds against the line and its delta steps, outlined in the route colour,
 * which holds against the ground the arms reach onto beyond the line. The
 * map key draws its row from the same pair.
 */
export function directionColours(palette: MapPalette): { glyph: string; outline: string } {
  return { glyph: palette.casing, outline: palette.route };
}

/** Forward follows the line from its first coordinate, reverse turns the chevron round. */
export type LineDirection = 'forward' | 'reverse';

export function buildDirectionLayer({
  id,
  source,
  palette,
  direction,
}: {
  id: string;
  /** The subject line's own source. */
  source: string;
  palette: MapPalette;
  /** The direction shown, or null to draw nothing while keeping the layer mounted. */
  direction: LineDirection | null;
}): MapLayerSpec {
  const { glyph, outline } = directionColours(palette);
  return {
    id,
    type: 'symbol',
    source,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': DIRECTION_SPACING,
      'icon-image': DIRECTION_ICON_ID,
      'icon-size': DIRECTION_ICON_SIZE,
      'icon-rotate': direction === 'reverse' ? 180 : 0,
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-color': glyph,
      'icon-halo-color': outline,
      'icon-halo-width': DIRECTION_OUTLINE_WIDTH,
      'icon-opacity': direction ? 1 : 0,
    },
  };
}
