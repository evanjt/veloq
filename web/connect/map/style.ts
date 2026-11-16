// The page's basemap styles. They are the app's own, taken from the module the
// app resolves them through and left on their upstream host, which is what a
// browser reaches. The tones come from the app's palette, so the page draws the
// base the phone draws.

import { EOX_S2CLOUDLESS_TEMPLATE } from '@/features/maps/lib/eoxTemplate';
import { upstreamStyle } from '@/features/maps/lib/htmlBuilders/upstreamStyle';
import {
  BASE_MAP_ATTRIBUTION,
  CREDIT_SEPARATOR,
  MAP_SOURCE_CREDITS,
} from '@/features/maps/lib/mapSourceCredits';
import { terrainSky } from '@/features/maps/lib/terrain3DPaint';
import { TERRAIN_UPSTREAM_TEMPLATE } from '@/features/maps/lib/terrainTemplate';

import { mapPalette } from '../theme';

/**
 * The bases the page draws. Satellite is the global imagery alone: the
 * regional providers the phone composes over it are each another host, which
 * the page's content security policy does not name.
 */
export type PageBase = 'light' | 'dark' | 'satellite';

/** The two bases the colour scheme chooses between. */
export type SchemeBase = Exclude<PageBase, 'satellite'>;

/** The base that follows the page's colour scheme. */
export function baseForScheme(dark: boolean): SchemeBase {
  return dark ? 'dark' : 'light';
}

/** The other of the two schemes' bases, for the toggle in the map's bar. */
export function otherBase(base: SchemeBase): SchemeBase {
  return base === 'dark' ? 'light' : 'dark';
}

/**
 * The ramps and sport colours the base is drawn with. Satellite takes the dark
 * tokens, as the phone does, since its imagery is dark ground.
 */
export function toneOf(base: PageBase): SchemeBase {
  return base === 'light' ? 'light' : 'dark';
}

/** The tilt terrain eases the camera to, in degrees from straight down, as the phone's. */
export const TERRAIN_PITCH = 60;

/** How much the relief is stretched, as the phone's. */
export const TERRAIN_EXAGGERATION = 1.5;

/** Tile size and deepest tile zoom of the global imagery, as the phone's composite declares them. */
const IMAGERY_TILE_SIZE = 128;
const IMAGERY_MAXZOOM = 14;

/** The elevation tiles, as the phone's terrain source declares them. */
const ELEVATION_SOURCE = {
  type: 'raster-dem',
  tiles: [TERRAIN_UPSTREAM_TEMPLATE],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
} as const;

/** The sources, background and glyphs of the satellite base: the global imagery on a dark ground. */
function satelliteStyle(): object {
  return {
    version: 8,
    glyphs: (upstreamStyle('dark') as { glyphs: string }).glyphs,
    sources: {
      'satellite-global': {
        type: 'raster',
        tiles: [EOX_S2CLOUDLESS_TEMPLATE],
        tileSize: IMAGERY_TILE_SIZE,
        maxzoom: IMAGERY_MAXZOOM,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0a1628' } },
      { id: 'satellite-layer-global', type: 'raster', source: 'satellite-global' },
    ],
  };
}

/**
 * The style MapLibre is given for a base: the vector bases' sources, sprite and
 * glyphs on the basemap host, the satellite base's imagery on the imagery host.
 * With terrain, the elevation source, the base's sky and the relief on the
 * ground are part of it, so a swap puts them back as it loads.
 */
export function pageStyle(base: PageBase, terrain = false): object {
  const style = base === 'satellite' ? satelliteStyle() : upstreamStyle(base);
  if (!terrain) return style;
  const { sources, layers, ...rest } = style as {
    sources: Record<string, unknown>;
    layers: object[];
  };
  return {
    ...rest,
    sources: { ...sources, terrain: ELEVATION_SOURCE },
    layers,
    terrain: { source: 'terrain', exaggeration: TERRAIN_EXAGGERATION },
    sky: terrainSky(mapPalette(base)),
  };
}

/** The line in the map's corner: the base's credit, and the elevation tiles' when terrain is on. */
export function pageAttribution(base: PageBase = 'light', terrain = false): string {
  const credit = base === 'satellite' ? MAP_SOURCE_CREDITS.eox.shortCredit : BASE_MAP_ATTRIBUTION;
  return terrain ? [credit, MAP_SOURCE_CREDITS.terrain.shortCredit].join(CREDIT_SEPARATOR) : credit;
}

/** The heat steps and line colours the base is drawn with, the phone's tokens. */
export function pagePalette(base: PageBase) {
  return mapPalette(base);
}
