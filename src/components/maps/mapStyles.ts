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
    attribution: 'USGS NAIP',
    bounds: [-124.733, 24.544, -66.95, 49.384], // Continental USA [west, south, east, north]
  },
  // Global fallback: EOX Sentinel-2 2016/2017 (CC BY 4.0 - commercial OK)
  // Note: 2018+ versions are CC BY-NC-SA (not commercial)
  eox: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 64,
    maxzoom: 14,
    attribution: 'Sentinel-2 cloudless — s2maps.eu by EOX, Copernicus Sentinel data 2017',
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
  layers: Array<
    | {
        id: string;
        type: 'raster';
        source: string;
        minzoom: number;
        maxzoom: number;
      }
    | {
        id: string;
        type: 'background';
        paint: { 'background-color': string };
      }
  >;
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
      // Dark background so empty tile areas show dark blue instead of white
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0a1628' },
      },
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
 * Build a combined satellite style for 3D contexts (Map3DWebView, TerrainSnapshotWebView).
 *
 * Uses the same tileSize: 64 as 2D — MapLibre GL JS v5.x (#3983) fixed the terrain LOD
 * bug that caused blurry tiles with terrain enabled. The v5.x distance-based LOD also
 * handles horizon tiles at 60° pitch (lower zoom for distant tiles), so the previous
 * concern about 16x more tile requests no longer applies.
 */
export function getCombinedSatelliteStyle3D(): CombinedSatelliteMapStyle {
  return getCombinedSatelliteStyle();
}

/**
 * Build a satellite style for snapshot rendering.
 * Uses the full combined style (all regional sources with bounds).
 * MapLibre only requests tiles from sources whose bounds overlap the viewport,
 * so irrelevant sources add zero network overhead.
 */
export function getSnapshotSatelliteStyle(
  _lat: number,
  _lng: number,
  _zoom: number
): CombinedSatelliteMapStyle {
  return getCombinedSatelliteStyle();
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
  satellite: 'Sentinel-2 cloudless by EOX', // Default, updated dynamically
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

/** Rewrite raster source tile URLs from https:// to cached-satellite:// */
export function rewriteSatelliteUrls(style: CombinedSatelliteMapStyle): CombinedSatelliteMapStyle {
  const rewritten: CombinedSatelliteMapStyle = JSON.parse(JSON.stringify(style));
  for (const source of Object.values(rewritten.sources)) {
    if (source.type === 'raster' && source.tiles) {
      source.tiles = source.tiles.map((url) => url.replace(/^https:\/\//, 'cached-satellite://'));
    }
  }
  return rewritten;
}

/** Replace TileJSON url with explicit cached-vector:// tiles array */
export function rewriteVectorUrls<T extends object>(style: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rewritten: any = JSON.parse(JSON.stringify(style));
  if (rewritten.sources) {
    for (const source of Object.values(rewritten.sources) as Array<Record<string, unknown>>) {
      if (source.type === 'vector' && source.url === 'https://tiles.openfreemap.org/planet') {
        delete source.url;
        source.tiles = ['cached-vector://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];
        source.maxzoom = 14;
      }
    }
  }
  return rewritten;
}

// 3D terrain attribution
export const TERRAIN_ATTRIBUTION = 'Terrain: USGS, NOAA (Mapzen Terrain Tiles)';

/**
 * Shared 3D terrain configuration — single source of truth for both
 * Map3DWebView (interactive detail) and TerrainSnapshotWebView (feed previews).
 * Keeps terrain source, sky, and hillshade definitions in sync.
 */
export const TERRAIN_3D_CONFIG = {
  source: {
    type: 'raster-dem' as const,
    tiles: ['cached-terrain://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium' as const,
    tileSize: 256,
    maxzoom: 15,
  },
  defaultExaggeration: 1.5,
  sky: {
    satellite: {
      'sky-color': '#1a3a5c',
      'horizon-color': '#2a4a6c',
      'fog-color': '#1a3050',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.8,
      'sky-horizon-blend': 0.5,
      'atmosphere-blend': 0.8,
    },
    dark: {
      'sky-color': '#0a1428',
      'horizon-color': '#1a2538',
      'fog-color': '#0e1520',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.8,
      'sky-horizon-blend': 0.5,
      'atmosphere-blend': 0.8,
    },
    light: {
      'sky-color': '#88C6FC',
      'horizon-color': '#B0C8DC',
      'fog-color': '#D8E4EE',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.8,
      'sky-horizon-blend': 0.5,
      'atmosphere-blend': 0.8,
    },
  },
  hillshadePaint: {
    dark: {
      'hillshade-shadow-color': 'rgba(10,10,20,0.35)',
      'hillshade-highlight-color': 'rgba(200,210,230,0.25)',
      'hillshade-illumination-anchor': 'map',
      'hillshade-exaggeration': 0.4,
    },
    light: {
      'hillshade-shadow-color': '#473B24',
      'hillshade-highlight-color': 'rgba(255,255,255,0.1)',
      'hillshade-illumination-anchor': 'map',
      'hillshade-exaggeration': 0.3,
    },
  },
  /**
   * Insert hillshade before the first transportation/building layer found.
   * In Liberty, 'building' is after all roads (layer ~85) — using it would
   * put hillshade ON TOP of roads. In Dark Matter, 'building' is before roads
   * (layer ~10). This list catches the correct insertion point in both styles.
   */
  hillshadeInsertBeforeCandidates: [
    'building',
    'aeroway_fill',
    'aeroway-area',
    'aeroway-runway',
    'tunnel_motorway_link_casing',
    'road_pier',
    'road_area_pattern',
    'road_motorway_casing',
    'highway_path',
  ],
} as const;

/**
 * Minimal map style for 3D terrain snapshot previews.
 *
 * Full vector styles (Liberty, Dark Matter) have dozens of layers (roads, labels,
 * railways, aeroways) that render flat at 60-degree pitch, clashing with 3D terrain.
 * This style keeps only background, water, and country boundaries — the terrain
 * hillshade provides all the visual detail needed for a 160px preview card.
 *
 * Bonus: fewer vector layers = fewer tiles to load = faster + more reliable rendering.
 */
export function getTerrainSnapshotStyle(mode: 'light' | 'dark') {
  const isLight = mode === 'light';
  return {
    version: 8 as const,
    sources: {
      openmaptiles: {
        type: 'vector' as const,
        url: 'https://tiles.openfreemap.org/planet',
      },
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'background',
        type: 'background' as const,
        paint: { 'background-color': isLight ? '#E8E0D8' : '#1A1A1A' },
      },
      // Landcover — broad natural areas
      {
        id: 'landcover_wood',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['all', ['==', '$type', 'Polygon'], ['==', 'subclass', 'wood']],
        paint: { 'fill-color': isLight ? '#ADD19E' : '#1A2E1A', 'fill-opacity': 0.7 },
      },
      {
        id: 'landcover_grass',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['all', ['==', '$type', 'Polygon'], ['in', 'subclass', 'grass', 'farmland']],
        paint: { 'fill-color': isLight ? '#D2E4B0' : '#1E2A16', 'fill-opacity': 0.6 },
      },
      // Landuse — human areas
      {
        id: 'landuse_residential',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['all', ['==', '$type', 'Polygon'], ['==', 'class', 'residential']],
        paint: { 'fill-color': isLight ? '#DFDBD6' : '#252525', 'fill-opacity': 0.6 },
      },
      {
        id: 'landuse_commercial',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['all', ['==', '$type', 'Polygon'], ['in', 'class', 'commercial', 'industrial']],
        paint: { 'fill-color': isLight ? '#E0D8D0' : '#282828', 'fill-opacity': 0.5 },
      },
      {
        id: 'landuse_park',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['all', ['==', '$type', 'Polygon'], ['in', 'class', 'park', 'cemetery']],
        paint: { 'fill-color': isLight ? '#A8CC8C' : '#1C2E1C', 'fill-opacity': 0.7 },
      },
      // Water
      {
        id: 'water',
        type: 'fill' as const,
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'brunnel', 'tunnel']],
        paint: { 'fill-color': isLight ? '#A3C7DF' : '#2C353C', 'fill-antialias': false },
      },
      {
        id: 'waterway',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': isLight ? '#A3C7DF' : '#2C353C',
          'line-width': 1,
          'line-opacity': 0.6,
        },
      },
      // Roads — major roads only, follow terrain for geographic context
      {
        id: 'road_motorway_casing',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'motorway']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#E0A050' : '#333333',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 4, 16, 8],
          'line-opacity': 0.6,
        },
      },
      {
        id: 'road_motorway',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'motorway']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#F0C070' : '#444444',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 2.5, 16, 5],
        },
      },
      {
        id: 'road_trunk_casing',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 7,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'trunk']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#D8A060' : '#333333',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 12, 3, 16, 6],
          'line-opacity': 0.5,
        },
      },
      {
        id: 'road_trunk',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 7,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'trunk']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#F0D080' : '#3A3A3A',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 12, 1.8, 16, 3.5],
        },
      },
      {
        id: 'road_primary',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'primary']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#FFFFFF' : '#353535',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 1.2, 16, 3],
          'line-opacity': 0.7,
        },
      },
      {
        id: 'road_secondary',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: ['all', ['==', '$type', 'LineString'], ['==', 'class', 'secondary']],
        layout: { 'line-join': 'round' as const, 'line-cap': 'round' as const },
        paint: {
          'line-color': isLight ? '#FFFFFF' : '#303030',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.2, 14, 0.8, 16, 2],
          'line-opacity': 0.5,
        },
      },
      // Boundaries
      {
        id: 'boundary_country',
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['==', 'admin_level', 2], ['!=', 'maritime', 1]],
        paint: {
          'line-color': isLight ? '#CCBBAA' : '#333333',
          'line-width': 0.7,
          'line-opacity': 0.4,
        },
      },
    ],
  };
}
