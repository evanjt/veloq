// Liberty style sources for OpenFreeMap tiles (OpenMapTiles, BSD/MIT/OFL).
// Source: https://tiles.openfreemap.org/styles/liberty (fetched 2026-04-03)

/** Where the shaded-relief ground comes from, so a rewrite can recognise it. */
export const NATURAL_EARTH_ORIGIN = 'https://tiles.openfreemap.org/natural_earth';

export const LIBERTY_SOURCES = {
  ne2_shaded: {
    maxzoom: 6,
    tileSize: 256,
    tiles: [`${NATURAL_EARTH_ORIGIN}/ne2sr/{z}/{x}/{y}.png`],
    type: 'raster' as const,
  },
  openmaptiles: {
    type: 'vector' as const,
    url: 'https://tiles.openfreemap.org/planet',
  },
} as const;
