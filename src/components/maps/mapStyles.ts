// Shared map style definitions and constants
// All sources are commercially licensed (MIT, BSD, OGD, CC BY, Public Domain)

import { DARK_MATTER_STYLE } from './darkMatterStyle';
import { isPointInSwitzerland, isPointInFrance, isPointInUSA } from './countryBoundaries';

export type MapStyleType = 'light' | 'dark' | 'satellite';

// Satellite source identifiers for attribution
export type SatelliteSourceId = 'swisstopo' | 'ign' | 'naip' | 'eox';

// Map style URLs - no API key required
export const MAP_STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

// Region bounding boxes for satellite imagery
const REGIONS = {
  // Switzerland: slightly expanded bounds
  switzerland: {
    minLat: 45.8,
    maxLat: 47.8,
    minLng: 5.9,
    maxLng: 10.5,
    minZoom: 6, // Swisstopo works well at low zoom too
  },
  // France (metropolitan): slightly expanded bounds
  france: {
    minLat: 41.3,
    maxLat: 51.1,
    minLng: -5.1,
    maxLng: 9.6,
    minZoom: 8, // IGN is useful at zoom 8+
  },
  // Continental USA
  usa: {
    minLat: 24.5,
    maxLat: 49.4,
    minLng: -125,
    maxLng: -66.9,
    minZoom: 10, // NAIP high-res kicks in at zoom 10+
  },
} as const;

// Satellite source configuration type
interface SatelliteSource {
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
  /** Geographic bounds [west, south, east, north] to limit tile requests */
  bounds?: [number, number, number, number];
}

// Satellite tile sources - all commercially licensed
export const SATELLITE_SOURCES: Record<SatelliteSourceId, SatelliteSource> = {
  // Switzerland: Swisstopo SWISSIMAGE (OGD license - commercial OK)
  // Bounds tightened to actual country shape
  swisstopo: {
    tiles: [
      'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: 64,
    maxzoom: 20,
    attribution: '© swisstopo',
    bounds: [5.956, 45.818, 10.492, 47.808], // Switzerland actual extent [west, south, east, north]
  },
  // France: IGN BD ORTHO via Géoplateforme (Licence Ouverte 2.0 - commercial OK)
  // Bounds exclude Switzerland (handled separately with higher priority)
  ign: {
    tiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: 64,
    maxzoom: 20,
    attribution: '© IGN France',
    bounds: [-5.142, 41.333, 9.56, 51.089], // Metropolitan France [west, south, east, north]
  },
  // USA: USGS NAIP (Public Domain - commercial OK)
  naip: {
    tiles: [
      'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 64,
    maxzoom: 17,
    attribution: '© USDA NAIP',
    bounds: [-124.733, 24.544, -66.95, 49.384], // Continental USA [west, south, east, north]
  },
  // Global fallback: EOX Sentinel-2 2016/2017 (CC BY 4.0 - commercial OK)
  // Note: 2018+ versions are CC BY-NC-SA (not commercial)
  eox: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 64,
    maxzoom: 14,
    attribution: 'Sentinel-2 cloudless by EOX © Copernicus 2016-2017',
    // No bounds - global coverage
  },
};

/**
 * Determine the best satellite source for a given location and zoom level.
 * Returns the source ID and whether regional high-res imagery is available.
 */
export function getSatelliteSourceId(lat: number, lng: number, zoom: number): SatelliteSourceId {
  // Switzerland - use Swisstopo with precise boundary check
  if (zoom >= REGIONS.switzerland.minZoom && isPointInSwitzerland(lng, lat)) {
    return 'swisstopo';
  }

  // France - use IGN with precise boundary check (excludes Switzerland)
  if (zoom >= REGIONS.france.minZoom && isPointInFrance(lng, lat)) {
    return 'ign';
  }

  // USA - use NAIP with precise boundary check
  if (zoom >= REGIONS.usa.minZoom && isPointInUSA(lng, lat)) {
    return 'naip';
  }

  // Global fallback
  return 'eox';
}

// Type for combined satellite MapLibre style with multiple regional sources
export interface CombinedSatelliteMapStyle {
  version: 8;
  sources: Record<
    string,
    {
      type: 'raster';
      tiles: string[];
      tileSize: number;
      maxzoom: number;
      bounds?: [number, number, number, number];
    }
  >;
  layers: Array<{
    id: string;
    type: 'raster';
    source: string;
    minzoom: number;
    maxzoom: number;
  }>;
}

// Legacy type alias for backwards compatibility
export type SatelliteMapStyle = CombinedSatelliteMapStyle;

/**
 * Build a combined MapLibre style with all satellite sources layered.
 * EOX serves as the global base layer, regional sources overlay on top.
 *
 * NOTE: True polygon clipping of raster layers is not supported in MapLibre.
 * We use tightened rectangular bounds to minimize visible edges.
 * The bounds are set to the actual country extents rather than expanded boxes.
 */
export function getCombinedSatelliteStyle(): CombinedSatelliteMapStyle {
  return {
    version: 8,
    sources: {
      // Global base layer (EOX Sentinel-2)
      'satellite-eox': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.eox.tiles,
        tileSize: SATELLITE_SOURCES.eox.tileSize,
        maxzoom: SATELLITE_SOURCES.eox.maxzoom,
      },
      // Switzerland (Swisstopo) - bounded to actual Swiss territory extent
      'satellite-swisstopo': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.swisstopo.tiles,
        tileSize: SATELLITE_SOURCES.swisstopo.tileSize,
        maxzoom: SATELLITE_SOURCES.swisstopo.maxzoom,
        bounds: SATELLITE_SOURCES.swisstopo.bounds,
      },
      // France (IGN) - bounded to French territory
      'satellite-ign': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.ign.tiles,
        tileSize: SATELLITE_SOURCES.ign.tileSize,
        maxzoom: SATELLITE_SOURCES.ign.maxzoom,
        bounds: SATELLITE_SOURCES.ign.bounds,
      },
      // USA (NAIP) - bounded to continental US
      'satellite-naip': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.naip.tiles,
        tileSize: SATELLITE_SOURCES.naip.tileSize,
        maxzoom: SATELLITE_SOURCES.naip.maxzoom,
        bounds: SATELLITE_SOURCES.naip.bounds,
      },
    },
    layers: [
      // Base layer: EOX (global coverage, lowest resolution)
      {
        id: 'satellite-layer-eox',
        type: 'raster',
        source: 'satellite-eox',
        minzoom: 0,
        maxzoom: 22,
      },
      // Regional layers on top (higher resolution where available)
      // Order: France first (larger area), then Switzerland (overlays France where applicable)
      {
        id: 'satellite-layer-ign',
        type: 'raster',
        source: 'satellite-ign',
        minzoom: REGIONS.france.minZoom,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-naip',
        type: 'raster',
        source: 'satellite-naip',
        minzoom: REGIONS.usa.minZoom,
        maxzoom: 22,
      },
      // Switzerland layer - high resolution imagery
      // Only shows at zoom 8+ where the rectangular boundary is less noticeable
      {
        id: 'satellite-layer-swisstopo',
        type: 'raster',
        source: 'satellite-swisstopo',
        minzoom: 8,
        maxzoom: 22,
      },
    ],
  };
}

/**
 * Build a MapLibre style object for satellite imagery at a given location.
 * @deprecated Use getCombinedSatelliteStyle() for multi-region support
 */
export function getSatelliteStyle(
  lat: number,
  lng: number,
  zoom: number
): { style: CombinedSatelliteMapStyle; sourceId: SatelliteSourceId } {
  // Return combined style - sourceId indicates which regional source is primary
  const sourceId = getSatelliteSourceId(lat, lng, zoom);
  return { style: getCombinedSatelliteStyle(), sourceId };
}

// Combined satellite style with all regional sources
const SATELLITE_STYLE_BASE: CombinedSatelliteMapStyle = getCombinedSatelliteStyle();

// Legacy export for backward compatibility
export const SATELLITE_STYLE = SATELLITE_STYLE_BASE;

// Union type for all possible map styles
export type MapStyleValue = string | SatelliteMapStyle | typeof DARK_MATTER_STYLE;

// Get the MapLibre style value for a given style type
export function getMapStyle(
  style: MapStyleType,
  location?: { lat: number; lng: number; zoom: number }
): MapStyleValue {
  if (style === 'satellite') {
    if (location) {
      return getSatelliteStyle(location.lat, location.lng, location.zoom).style;
    }
    return SATELLITE_STYLE_BASE;
  }
  if (style === 'dark') {
    return DARK_MATTER_STYLE;
  }
  return MAP_STYLE_URLS.light;
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
  light: '© OpenFreeMap © OpenMapTiles © OpenStreetMap',
  dark: '© OpenFreeMap © OpenMapTiles © OpenStreetMap',
  satellite: '© EOX Sentinel-2', // Default, updated dynamically
};

// Get attribution for a specific satellite source
export function getSatelliteAttribution(sourceId: SatelliteSourceId): string {
  return SATELLITE_SOURCES[sourceId].attribution;
}

/**
 * Get combined attribution for all satellite sources visible in the current viewport.
 * Uses precise polygon boundaries for accurate attribution.
 */
export function getCombinedSatelliteAttribution(lat: number, lng: number, zoom: number): string {
  const attributions: string[] = [];

  // Check which regional sources are visible using precise polygon checks
  // Switzerland (Swisstopo) - highest priority, uses actual country boundary
  if (zoom >= REGIONS.switzerland.minZoom && isPointInSwitzerland(lng, lat)) {
    attributions.push(SATELLITE_SOURCES.swisstopo.attribution);
  }

  // France (IGN) - uses actual country boundary, excludes Switzerland
  if (zoom >= REGIONS.france.minZoom && isPointInFrance(lng, lat)) {
    attributions.push(SATELLITE_SOURCES.ign.attribution);
  }

  // USA (NAIP) - uses actual country boundary
  if (zoom >= REGIONS.usa.minZoom && isPointInUSA(lng, lat)) {
    attributions.push(SATELLITE_SOURCES.naip.attribution);
  }

  // Always include EOX as the global base
  attributions.push(SATELLITE_SOURCES.eox.attribution);

  return attributions.join(' | ');
}

// 3D terrain attribution
export const TERRAIN_ATTRIBUTION = '© AWS Terrain Tiles';
