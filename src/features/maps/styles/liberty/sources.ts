// Liberty style sources for OpenFreeMap tiles (OpenMapTiles, BSD/MIT/OFL).
// Source: https://tiles.openfreemap.org/styles/liberty (fetched 2026-04-03)

export const LIBERTY_SOURCES = {
  ne2_shaded: {
    maxzoom: 6,
    tileSize: 256,
    tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
    type: 'raster' as const,
  },
  openmaptiles: {
    type: 'vector' as const,
    url: 'https://tiles.openfreemap.org/planet',
  },
} as const;
