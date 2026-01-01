// Shared map style definitions and constants

export type MapStyleType = 'light' | 'dark' | 'satellite';

// Map style URLs - no API key required
export const MAP_STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const;

// Satellite style using EOX Sentinel-2 cloudless imagery (free, no API key)
export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: 'raster' as const,
      tiles: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
      ],
      tileSize: 256,
      maxzoom: 14,
    },
  },
  layers: [
    {
      id: 'satellite-layer',
      type: 'raster' as const,
      source: 'satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

// Get the MapLibre style value for a given style type
export function getMapStyle(style: MapStyleType): string | typeof SATELLITE_STYLE {
  if (style === 'satellite') return SATELLITE_STYLE;
  return MAP_STYLE_URLS[style];
}

// Check if a style should use dark UI elements
export function isDarkStyle(style: MapStyleType): boolean {
  return style === 'dark' || style === 'satellite';
}

// Get the next style in the cycle
export function getNextStyle(current: MapStyleType): MapStyleType {
  if (current === 'light') return 'dark';
  if (current === 'dark') return 'satellite';
  return 'light';
}

// Get the icon name for the style toggle button (shows what you'll switch TO)
export function getStyleIcon(
  current: MapStyleType
): 'weather-night' | 'satellite-variant' | 'weather-sunny' {
  if (current === 'light') return 'weather-night';
  if (current === 'dark') return 'satellite-variant';
  return 'weather-sunny';
}

// Attribution text for each map source
export const MAP_ATTRIBUTIONS: Record<MapStyleType, string> = {
  light: '© OpenFreeMap © OpenStreetMap',
  dark: '© CARTO © OpenStreetMap',
  satellite: '© EOX Sentinel-2',
};

// 3D terrain attribution
export const TERRAIN_ATTRIBUTION = '© AWS Terrain Tiles';
