// Liberty style adapted for OpenFreeMap tiles
// Original style: https://github.com/openmaptiles/osm-liberty (BSD license)
// Tiles: OpenFreeMap (MIT license)
// Fonts: Noto Sans (SIL Open Font License)
//
// Embedded locally to avoid CDN serving stale versions with removed fonts.
// Source: https://tiles.openfreemap.org/styles/liberty (fetched 2026-04-03)

import { LIBERTY_SOURCES } from './sources';
import { LIBERTY_LAYERS } from './layers';

export const LIBERTY_STYLE = {
  version: 8 as const,
  sources: LIBERTY_SOURCES,
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: LIBERTY_LAYERS,
} as const;
