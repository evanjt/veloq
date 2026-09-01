// Shared map style definitions and constants
// All sources are commercially licensed (MIT, BSD, OGD, CC BY, Public Domain)

import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';

export type MapStyleType = 'light' | 'dark' | 'satellite';

// Satellite source identifiers for attribution
export type SatelliteSourceId =
  | 'swisstopo'
  | 'ign'
  | 'naip'
  | 'eox'
  | 'spain'
  | 'austria'
  | 'netherlands'
  | 'czechia'
  | 'poland'
  | 'luxembourg';

// Base styles the surfaces load. Liberty is embedded locally rather than
// fetched, so a cold map does not wait on a style request and the CDN cannot
// serve a build with fonts removed from under us.
export const MAP_STYLE_URLS = {
  light: LIBERTY_STYLE,
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
  // Spain (mainland + Balearics; the Canaries sit outside these bounds)
  spain: {
    minLat: 36.0,
    maxLat: 43.8,
    minLng: -9.4,
    maxLng: 4.4,
    minZoom: 8,
  },
  // Austria
  austria: {
    minLat: 46.37,
    maxLat: 49.02,
    minLng: 9.53,
    maxLng: 17.17,
    minZoom: 8,
  },
  // Netherlands
  netherlands: {
    minLat: 50.75,
    maxLat: 53.55,
    minLng: 3.37,
    maxLng: 7.21,
    minZoom: 8,
  },
  // Czech Republic
  czechia: {
    minLat: 48.55,
    maxLat: 51.06,
    minLng: 12.09,
    maxLng: 18.85,
    minZoom: 8,
  },
  // Poland
  poland: {
    minLat: 49.0,
    maxLat: 54.85,
    minLng: 14.12,
    maxLng: 24.15,
    minZoom: 8,
  },
  // Luxembourg
  luxembourg: {
    minLat: 49.44,
    maxLat: 50.18,
    minLng: 5.73,
    maxLng: 6.53,
    minZoom: 8,
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
  // Spain: PNOA via IGN Spain (CC BY 4.0 scne.es - commercial OK)
  // Orden FOM/2807/2015 guarantees free and unrestricted reuse
  spain: {
    tiles: [
      'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&Format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
    ],
    tileSize: 64,
    maxzoom: 20,
    attribution: 'CC BY 4.0 scne.es',
    bounds: [-9.4, 36.0, 4.4, 43.8],
  },
  // Austria: basemap.at Orthophoto (CC BY 4.0 OGD Austria - commercial OK)
  // maps{1-4}.wien.gv.at subdomains have DNS issues - use maps.wien.gv.at (load-balanced)
  austria: {
    tiles: ['https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'],
    tileSize: 64,
    maxzoom: 20,
    attribution: 'Datenquelle: basemap.at',
    bounds: [9.53, 46.37, 17.17, 49.02],
  },
  // Netherlands: PDOK Luchtfoto (CC BY 4.0 Kadaster - commercial OK)
  netherlands: {
    tiles: [
      'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: 64,
    maxzoom: 21,
    attribution: '© Kadaster / PDOK',
    bounds: [3.37, 50.75, 7.21, 53.55],
  },
  // Czech Republic: CUZK Orthophoto (CC BY 4.0 since July 2023 - commercial OK)
  czechia: {
    tiles: [
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile/1.0.0/ORTOFOTO_WM/default/GoogleMapsCompatible/{z}/{y}/{x}',
    ],
    tileSize: 64,
    maxzoom: 18,
    attribution: '© ČÚZK',
    bounds: [12.09, 48.55, 18.85, 51.06],
  },
  // Poland: GUGiK Orthophoto (free for all use, Art. 40a Geodetic Law 2020 - commercial OK)
  poland: {
    tiles: [
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: 64,
    maxzoom: 19,
    attribution: '© GUGiK',
    bounds: [14.12, 49.0, 24.15, 54.85],
  },
  // Luxembourg: ACT BD-L-ORTHO (CC0 Public Domain - commercial OK, no attribution required)
  luxembourg: {
    tiles: [
      'https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
      'https://wmts2.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
      'https://wmts3.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
      'https://wmts4.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
    ],
    tileSize: 64,
    maxzoom: 21,
    attribution: '© ACT Luxembourg',
    bounds: [5.73, 49.44, 6.53, 50.18],
  },
  // Global fallback: EOX Sentinel-2 2016/2017 (CC BY 4.0 - commercial OK)
  // Note: 2018+ versions are CC BY-NC-SA (not commercial)
  eox: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 64,
    maxzoom: 14,
    attribution: 'Sentinel-2 cloudless - s2maps.eu by EOX, Copernicus Sentinel data 2017',
    // No bounds - global coverage
  },
};

// Type for combined satellite MapLibre style with multiple regional sources
export interface CombinedSatelliteMapStyle {
  version: 8;
  glyphs?: string;
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
  layers: (
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
  )[];
}

export function getCombinedSatelliteStyle(): CombinedSatelliteMapStyle {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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
      // Spain (PNOA) - mainland + Balearics
      'satellite-spain': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.spain.tiles,
        tileSize: SATELLITE_SOURCES.spain.tileSize,
        maxzoom: SATELLITE_SOURCES.spain.maxzoom,
        bounds: SATELLITE_SOURCES.spain.bounds,
      },
      // Austria (basemap.at)
      'satellite-austria': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.austria.tiles,
        tileSize: SATELLITE_SOURCES.austria.tileSize,
        maxzoom: SATELLITE_SOURCES.austria.maxzoom,
        bounds: SATELLITE_SOURCES.austria.bounds,
      },
      // Netherlands (PDOK)
      'satellite-netherlands': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.netherlands.tiles,
        tileSize: SATELLITE_SOURCES.netherlands.tileSize,
        maxzoom: SATELLITE_SOURCES.netherlands.maxzoom,
        bounds: SATELLITE_SOURCES.netherlands.bounds,
      },
      // Czech Republic (CUZK)
      'satellite-czechia': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.czechia.tiles,
        tileSize: SATELLITE_SOURCES.czechia.tileSize,
        maxzoom: SATELLITE_SOURCES.czechia.maxzoom,
        bounds: SATELLITE_SOURCES.czechia.bounds,
      },
      // Poland (GUGiK)
      'satellite-poland': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.poland.tiles,
        tileSize: SATELLITE_SOURCES.poland.tileSize,
        maxzoom: SATELLITE_SOURCES.poland.maxzoom,
        bounds: SATELLITE_SOURCES.poland.bounds,
      },
      // Luxembourg (ACT)
      'satellite-luxembourg': {
        type: 'raster',
        tiles: SATELLITE_SOURCES.luxembourg.tiles,
        tileSize: SATELLITE_SOURCES.luxembourg.tileSize,
        maxzoom: SATELLITE_SOURCES.luxembourg.maxzoom,
        bounds: SATELLITE_SOURCES.luxembourg.bounds,
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
      // Order: largest areas first, smallest on top (later = higher priority)
      {
        id: 'satellite-layer-spain',
        type: 'raster',
        source: 'satellite-spain',
        minzoom: REGIONS.spain.minZoom,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-poland',
        type: 'raster',
        source: 'satellite-poland',
        minzoom: REGIONS.poland.minZoom,
        maxzoom: 22,
      },
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
      {
        id: 'satellite-layer-czechia',
        type: 'raster',
        source: 'satellite-czechia',
        minzoom: REGIONS.czechia.minZoom,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-netherlands',
        type: 'raster',
        source: 'satellite-netherlands',
        minzoom: REGIONS.netherlands.minZoom,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-austria',
        type: 'raster',
        source: 'satellite-austria',
        minzoom: REGIONS.austria.minZoom,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-luxembourg',
        type: 'raster',
        source: 'satellite-luxembourg',
        minzoom: REGIONS.luxembourg.minZoom,
        maxzoom: 22,
      },
      // Switzerland - highest priority, on top of Austria and France
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

/**
 * Get combined attribution for all satellite sources visible in the current viewport.
 * Uses precise polygon boundaries for accurate attribution.
 */
// Each regional source and the zoom gate that governs it. Attribution is
// derived from the same bounds MapLibre clips the raster to, so the credit
// line always names the imagery actually drawn.
const REGIONAL_ATTRIBUTION_SOURCES: [SatelliteSourceId, keyof typeof REGIONS][] = [
  ['swisstopo', 'switzerland'],
  ['luxembourg', 'luxembourg'],
  ['austria', 'austria'],
  ['netherlands', 'netherlands'],
  ['ign', 'france'],
  ['czechia', 'czechia'],
  ['spain', 'spain'],
  ['poland', 'poland'],
  ['naip', 'usa'],
];

function boundsContain(
  bounds: [number, number, number, number] | undefined,
  lng: number,
  lat: number
): boolean {
  if (!bounds) return false;
  const [west, south, east, north] = bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

export function getCombinedSatelliteAttribution(lat: number, lng: number, zoom: number): string {
  const attributions = REGIONAL_ATTRIBUTION_SOURCES.filter(
    ([id, region]) =>
      zoom >= REGIONS[region].minZoom && boundsContain(SATELLITE_SOURCES[id].bounds, lng, lat)
  ).map(([id]) => SATELLITE_SOURCES[id].attribution);

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
    for (const source of Object.values(rewritten.sources) as Record<string, unknown>[]) {
      if (source.type === 'vector' && source.url === 'https://tiles.openfreemap.org/planet') {
        // Point the source at the TileJSON through the protocol, rather than at a
        // tile path built here. The origin serves tiles from a dated snapshot
        // segment the TileJSON names, and answers the unversioned path with an
        // empty body, so a template written here draws nothing. The handler
        // rewrites the TileJSON's own template back onto the protocol.
        source.url = 'cached-vector://tiles.openfreemap.org/planet';
        delete source.tiles;
        source.maxzoom = 14;
      }
    }
  }
  return rewritten;
}

// 3D terrain attribution
export const TERRAIN_ATTRIBUTION = 'Terrain: USGS, NOAA (Mapzen Terrain Tiles)';

/**
 * Shared 3D terrain configuration - single source of truth for both
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
   * In Liberty, 'building' is after all roads (layer ~85) - using it would
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
