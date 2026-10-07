// Shared map style definitions and constants
// All sources are commercially licensed (MIT, BSD, OGD, CC BY, Public Domain)

import { mapPageBaseUrl, nativeTileUrl } from '@/features/maps/lib/tileTransport';
import { TERRAIN_UPSTREAM_TEMPLATE } from '@/features/maps/lib/terrainTemplate';
import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';
import { NATURAL_EARTH_ORIGIN } from '@/features/maps/styles/liberty/sources';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';
import { ink, colorWithOpacity } from '@/theme';
import { HILLSHADE_DARK_SHADOW, HILLSHADE_DARK_HIGHLIGHT } from '@/features/maps/styles/hillshade';

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

/** Geographic bounds, [west, south, east, north]. */
type Bbox = [number, number, number, number];

// Satellite source configuration type
interface SatelliteSource {
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
  /** Geographic bounds to limit tile requests, where one box is close enough */
  bounds?: Bbox;
  /**
   * The same thing for a country a single box cannot hold without reaching
   * into a neighbour that has its own imagery. Each box becomes a source of
   * its own, so MapLibre asks for no tile outside them.
   */
  boxes?: Bbox[];
}

/**
 * Every provider serves 256-pixel tiles. Declaring 128 keeps a 2x oversample
 * for sharpness while asking for a quarter of the tiles a 256 declaration would
 * need at zoom levels two deeper than declaring 64 does.
 */
export const SATELLITE_TILE_SIZE = 128;

// Satellite tile sources - all commercially licensed
export const SATELLITE_SOURCES: Record<SatelliteSourceId, SatelliteSource> = {
  // Switzerland: Swisstopo SWISSIMAGE (OGD license - commercial OK)
  //
  // A staircase rather than the Swiss extent. The single box ran the full
  // rectangle 5.956-10.492E by 45.818-47.808N, which holds Chamonix, Annecy,
  // Aosta and Vorarlberg, and swisstopo sits above every other regional
  // raster: it answered 404 over all of them and took the credit from whoever
  // did draw them.
  //
  // Rectangles cannot follow this border either, so what stays inside is the
  // ground no rectangle can cut away from Swiss ground beside it: the French
  // and Italian shores immediately around Geneva, the Italian mouth of the
  // Poschiavo valley, and Konstanz where the border runs through the town.
  swisstopo: {
    tiles: [
      'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: '© swisstopo',
    boxes: [
      [8.55, 45.83, 9.15, 46.12], // Mendrisiotto and Lugano, north of Como
      [7.5, 45.95, 8.25, 46.1], // Upper Valais and the Matterhorn, north of Aosta
      [5.95, 46.12, 6.35, 46.33], // The Geneva salient
      [6.95, 46.1, 8.1, 46.36], // Valais, east of Chamonix and the Chablais
      [8.1, 46.145, 9.6, 46.36], // Ticino and Misox, north of the Ossola
      [9.95, 46.2, 10.35, 46.5], // Poschiavo and Val Müstair, east of the Valtellina
      [6.1, 46.36, 6.45, 46.47], // The lake's north shore, west of Thonon
      [6.75, 46.36, 9.9, 46.47], // Montreux east, skipping the French shore
      [6.1, 46.47, 9.9, 46.62], // Vaud, Oberland and Graubünden
      [6.3, 46.62, 6.6, 46.75], // Orbe and the Vallée de Joux, east of Vallorbe
      [6.5, 46.75, 6.6, 47.0], // Sainte-Croix and the Val-de-Travers, east of Pontarlier
      [6.82, 46.15, 6.95, 46.36], // Val d'Illiez, east of Morzine
      [7.05, 45.94, 7.5, 46.1], // Entremont, Bagnes and Hérens, north of Aosta
      [6.6, 46.62, 10.5, 47.0], // The Mittelland and the Engadine
      [6.35, 47.0, 9.55, 47.45], // Jura, Aargau and the Zürich basin, west of Vorarlberg
      [7.0, 47.45, 9.55, 47.82], // Basel, Schaffhausen and the Bodensee shore
    ],
  },
  // France: IGN BD ORTHO via Géoplateforme (Licence Ouverte 2.0 - commercial OK)
  //
  // A staircase down the eastern border rather than one metropolitan bbox. The
  // single box ran to 9.56°E, which covers Geneva, Valais, the Bernese
  // Oberland and Piedmont, and IGN answers 404 for every tile of them: a pan
  // over the Valais logged 247 dead fetches in a minute. The western,
  // southern and northern edges are still one box's worth, because nothing
  // there has imagery of its own to reach into.
  //
  // Rectangles cannot follow the border exactly, so the Geneva salient and the
  // Swiss shore of Lake Geneva stay inside the Haute-Savoie box. Swisstopo
  // draws over both, and keeping them costs a few requests where dropping them
  // would cost Thonon, Évian and Chamonix their imagery.
  //
  // The south-western edge is a staircase for the same reason. Every box still
  // ran west to -5.142 and the first ran south to 41.333, which is Navarre,
  // Aragón, Catalonia, the Ebro and as far in as Salamanca. PNOA has imagery
  // for all of it and `satellite-layer-spain` sits below IGN, so IGN was asked
  // first and answered 404 over ground that was already drawn. The southern
  // boxes now stop at the Pyrenean crest, and Corsica is a box of its own
  // because nothing joins it to the mainland at that latitude.
  //
  // What stays inside is Andorra, the Val d'Aran and the crest itself, which no
  // rectangle can cut away from the French valleys beside them.
  ign: {
    tiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: '© IGN France',
    boxes: [
      [8.5, 41.33, 9.6, 43.05], // Corsica
      [1.45, 42.33, 9.56, 42.6], // Cerdagne and Roussillon, east of the Segre
      [0.55, 42.6, 9.56, 42.8], // Ariège, Aude and Luchon
      [-0.15, 42.72, 0.55, 42.8], // Gavarnie to Aragnouet
      [-1.3, 42.99, -0.75, 43.05], // Soule and Iraty
      [-0.75, 42.8, 9.56, 43.05], // Comminges and the Hautes-Pyrénées
      [-1.8, 43.05, 7.75, 43.35], // Béarn, Marseille and the coast to Hendaye
      [-5.142, 43.35, 7.75, 44.2], // Aquitaine and Provence, north of the border
      [-5.142, 44.2, 7.2, 45.818], // Dauphiné and Savoie, west of Piedmont
      [-5.142, 45.818, 7.05, 46.55], // Haute-Savoie, Chamonix and the lake shore
      [-5.142, 46.55, 6.95, 47.5], // Jura and Doubs
      [-5.142, 47.5, 7.45, 47.85], // Sundgau, west of Basel
      [-5.142, 47.85, 8.25, 51.089], // Alsace north of Switzerland, and the rest
    ],
  },
  // USA: USGS NAIP (Public Domain - commercial OK)
  naip: {
    tiles: [
      'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
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
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: 'CC BY 4.0 scne.es',
    bounds: [-9.4, 36.0, 4.4, 43.8],
  },
  // Austria: basemap.at Orthophoto (CC BY 4.0 OGD Austria - commercial OK)
  // maps{1-4}.wien.gv.at subdomains have DNS issues - use maps.wien.gv.at (load-balanced)
  austria: {
    tiles: ['https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: 'Datenquelle: basemap.at',
    bounds: [9.53, 46.37, 17.17, 49.02],
  },
  // Netherlands: PDOK Luchtfoto (CC BY 4.0 Kadaster - commercial OK)
  netherlands: {
    tiles: [
      'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 21,
    attribution: '© Kadaster / PDOK',
    bounds: [3.37, 50.75, 7.21, 53.55],
  },
  // Czech Republic: CUZK Orthophoto (CC BY 4.0 since July 2023 - commercial OK)
  czechia: {
    tiles: [
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile/1.0.0/ORTOFOTO_WM/default/GoogleMapsCompatible/{z}/{y}/{x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 18,
    attribution: '© ČÚZK',
    bounds: [12.09, 48.55, 18.85, 51.06],
  },
  // Poland: GUGiK Orthophoto (free for all use, Art. 40a Geodetic Law 2020 - commercial OK)
  poland: {
    tiles: [
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
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
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 21,
    attribution: '© ACT Luxembourg',
    bounds: [5.73, 49.44, 6.53, 50.18],
  },
  // Global fallback: EOX Sentinel-2 2016/2017 (CC BY 4.0 - commercial OK)
  // Note: 2018+ versions are CC BY-NC-SA (not commercial)
  eox: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: SATELLITE_TILE_SIZE,
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
      bounds?: [number, number, number, number] | undefined;
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

/**
 * One MapLibre source per box of a multi-box satellite source, named
 * `satellite-<id>-<n>`.
 *
 * MapLibre takes a single bbox per source and nothing finer, so a country
 * whose border a rectangle cannot follow is handed over as several sources
 * sharing one template. They are disjoint, so no tile is fetched or stored
 * twice, and Rust files each under its own directory.
 */
function boxedSources(id: SatelliteSourceId): CombinedSatelliteMapStyle['sources'] {
  const source = SATELLITE_SOURCES[id];
  const boxes = source.boxes ?? [];
  return Object.fromEntries(
    boxes.map((bounds, i) => [
      `satellite-${id}-${i + 1}`,
      {
        type: 'raster' as const,
        tiles: source.tiles,
        tileSize: source.tileSize,
        maxzoom: source.maxzoom,
        bounds,
      },
    ])
  );
}

/** The layers those sources draw through, contiguous and all at one minzoom. */
function boxedLayers(
  id: SatelliteSourceId,
  minzoom: number
): Extract<CombinedSatelliteMapStyle['layers'][number], { type: 'raster' }>[] {
  const boxes = SATELLITE_SOURCES[id].boxes ?? [];
  return boxes.map((_, i) => ({
    id: `satellite-layer-${id}-${i + 1}`,
    type: 'raster' as const,
    source: `satellite-${id}-${i + 1}`,
    minzoom,
    maxzoom: 22,
  }));
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
      // Switzerland (Swisstopo) - one source per box of the border staircase
      ...boxedSources('swisstopo'),
      // France (IGN) - one source per box of the eastern staircase
      ...boxedSources('ign'),
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
      ...boxedLayers('ign', REGIONS.france.minZoom),
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
      ...boxedLayers('swisstopo', 8),
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
function boundsContain(bounds: Bbox | undefined, lng: number, lat: number): boolean {
  if (!bounds) return false;
  const [west, south, east, north] = bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * Whether a source draws at all at this point, by the same boxes MapLibre
 * fetches through. A source with no box anywhere is global, which is EOX.
 */
function sourceCovers(source: SatelliteSource, lng: number, lat: number): boolean {
  if (source.boxes) return source.boxes.some((b) => boundsContain(b, lng, lat));
  return boundsContain(source.bounds, lng, lat);
}

const LAYER_PREFIX = 'satellite-layer-';

/**
 * The satellite raster stack, top down, read off the style itself rather than
 * written out a second time. A source that moves in the layer list, or whose
 * `minzoom` changes, moves here with it.
 */
let layerStack: { id: SatelliteSourceId; minzoom: number }[] | null = null;

function satelliteLayerStack(): { id: SatelliteSourceId; minzoom: number }[] {
  if (!layerStack) {
    layerStack = getCombinedSatelliteStyle()
      .layers.filter((l) => l.id.startsWith(LAYER_PREFIX) && 'minzoom' in l)
      .map((l) => ({
        // A multi-box source draws through `satellite-layer-<id>-<n>`, and
        // every one of those is the same source and the same credit.
        id: l.id.slice(LAYER_PREFIX.length).replace(/-\d+$/, '') as SatelliteSourceId,
        minzoom: 'minzoom' in l ? l.minzoom : 0,
      }))
      .reverse();
  }
  return layerStack;
}

/** The source drawn at one point on this zoom: the topmost that covers it. */
function visibleSourceAt(lng: number, lat: number, zoom: number): SatelliteSourceId {
  for (const { id, minzoom } of satelliteLayerStack()) {
    if (zoom < minzoom) continue;
    const source = SATELLITE_SOURCES[id];
    // No box anywhere means global coverage, which is EOX and the end of the
    // stack.
    if ((source.bounds || source.boxes) && !sourceCovers(source, lng, lat)) continue;
    return id;
  }
  return 'eox';
}

/**
 * The credit for the satellite imagery drawn at (lat, lng) on this zoom, or
 * across a viewport when its bounds are given.
 *
 * Every regional raster is opaque and they are stacked in one fixed order, so
 * at any one point exactly one of them is visible: the topmost whose bounds
 * contain the point and whose layer `minzoom` is met. EOX sits under all of
 * them and is credited only where nothing covers it.
 *
 * A viewport is sampled at its corners, edge midpoints and centre, and every
 * source visible at any of them is credited once, in stack order, so a view
 * across a region border names each source it draws. Sources are credited from
 * samples, so a source covering only a sliver between samples can go unnamed.
 */
export function getCombinedSatelliteAttribution(
  lat: number,
  lng: number,
  zoom: number,
  bounds?: LngLatBounds
): string {
  const visible = new Set<SatelliteSourceId>([visibleSourceAt(lng, lat, zoom)]);
  if (bounds) {
    const [west, south] = bounds.sw;
    const [east, north] = bounds.ne;
    const lngs = [west, (west + east) / 2, east];
    const lats = [south, (south + north) / 2, north];
    for (const x of lngs) for (const y of lats) visible.add(visibleSourceAt(x, y, zoom));
  }
  // EOX has no layer minzoom, so it is not in the stack and sits under it.
  const ordered = [...new Set(satelliteLayerStack().map(({ id }) => id))];
  if (!ordered.includes('eox')) ordered.push('eox');
  return ordered
    .filter((id) => visible.has(id))
    .map((id) => SATELLITE_SOURCES[id].attribution)
    .join(' | ');
}

/**
 * Point every satellite raster at the tile store.
 *
 * Each source's upstream template goes to Rust once and the page asks for an
 * intercepted URL, so the store answers a hit and fills a miss without the page
 * knowing which happened. Where Rust cannot be reached, which is the test
 * bench, a source keeps its upstream URL.
 */
export function rewriteSatelliteUrls(style: CombinedSatelliteMapStyle): CombinedSatelliteMapStyle {
  const rewritten: CombinedSatelliteMapStyle = JSON.parse(JSON.stringify(style));
  for (const [key, source] of Object.entries(rewritten.sources)) {
    if (source.type !== 'raster' || !source.tiles) continue;
    const native = nativeTileUrl(key, source.tiles[0]);
    if (native) source.tiles = [native];
  }
  return rewritten;
}

/**
 * Point the light style's `ne2_shaded` ground raster at the tile store.
 *
 * The layer draws below zoom 6, where it is the whole visible ground, so left on
 * the network a map with no radio opens on nothing. Only sources pointing at the
 * OpenFreeMap Natural Earth path are touched, so a satellite raster keeps the
 * URL `rewriteSatelliteUrls` gave it.
 */
export function rewriteGroundRasterUrls<T extends object>(style: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rewritten: any = JSON.parse(JSON.stringify(style));
  for (const [key, source] of Object.entries(rewritten.sources ?? {}) as [
    string,
    Record<string, unknown>,
  ][]) {
    if (source.type !== 'raster' || !Array.isArray(source.tiles)) continue;
    const tiles = source.tiles as string[];
    if (!tiles.some((url) => url.startsWith(NATURAL_EARTH_ORIGIN))) continue;
    const native = nativeTileUrl(key, tiles[0]);
    if (native) source.tiles = [native];
  }
  return rewritten;
}

/**
 * Point every vector source at the tile store.
 *
 * Rust is handed the TileJSON url itself rather than a tile template, because the origin serves tiles from a dated snapshot
 * segment only that document names and answers the unversioned path with an
 * empty body. Rust resolves it once and keeps what it resolved, so the page
 * never learns a tile path and states the extension instead.
 */
export function rewriteVectorUrls<T extends object>(style: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rewritten: any = JSON.parse(JSON.stringify(style));
  if (rewritten.sources) {
    for (const [key, source] of Object.entries(rewritten.sources) as [
      string,
      Record<string, unknown>,
    ][]) {
      // Any vector source named by a TileJSON url, not one hardcoded host. The
      // match used to be the literal openfreemap planet url, so a style on any
      // other vector host went through uncached with nothing saying so.
      //
      // Hand Rust the TileJSON, rather than a tile path built here. The origin
      // serves tiles from a dated snapshot segment the TileJSON names, and
      // answers the unversioned path with an empty body, so a template written
      // here draws nothing.
      if (
        source.type === 'vector' &&
        typeof source.url === 'string' &&
        source.url.startsWith('https://')
      ) {
        // `pbf` is stated rather than read off the template: a TileJSON url
        // names no file, and a vector tile is always protobuf.
        const native = nativeTileUrl(key, source.url, 'pbf');
        if (native) {
          source.tiles = [native];
          delete source.url;
          // The TileJSON carried it, and the store hands none to MapLibre.
          source.maxzoom = 14;
        }
      }
    }
  }
  return rewritten;
}

/**
 * Point the sprite and the glyphs at the app bundle.
 *
 * The platform interceptor answers `veloq-asset/<path>` on the page's own
 * origin out of the app bundle, and answers 404 for a path the app does not
 * carry. Only pages loaded on `mapPageBaseUrl()` may be rewritten.
 */
export function rewriteBundledAssets<T extends object>(style: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rewritten: any = JSON.parse(JSON.stringify(style));
  const assets = `${mapPageBaseUrl()}veloq-asset/`;
  if (typeof rewritten.sprite === 'string') {
    rewritten.sprite = rewritten.sprite.replace(/^https:\/\/tiles\.openfreemap\.org\//, assets);
  }
  if (typeof rewritten.glyphs === 'string') {
    rewritten.glyphs = rewritten.glyphs.replace(/^https:\/\/tiles\.openfreemap\.org\//, assets);
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
export { TERRAIN_UPSTREAM_TEMPLATE } from '@/features/maps/lib/terrainTemplate';

export const TERRAIN_3D_CONFIG = {
  source: {
    type: 'raster-dem' as const,
    tiles: [TERRAIN_UPSTREAM_TEMPLATE],
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
      'hillshade-shadow-color': HILLSHADE_DARK_SHADOW,
      'hillshade-highlight-color': HILLSHADE_DARK_HIGHLIGHT,
      'hillshade-illumination-anchor': 'map',
      'hillshade-exaggeration': 0.4,
    },
    light: {
      'hillshade-shadow-color': '#473B24',
      'hillshade-highlight-color': colorWithOpacity(ink.white, 0.1),
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

/**
 * Page script defining `hillshadeInsertIndex(layers, candidates)`: the index of
 * the first layer, in the style's own order, whose id is a candidate, or the
 * layer count when none is. Every 3D page walks the style's layers with it, so
 * the hillshade lands under the roads however the candidate list is ordered.
 */
export const HILLSHADE_INSERT_INDEX_SCRIPT = `
function hillshadeInsertIndex(layers, candidates) {
  var wanted = {};
  for (var ci = 0; ci < candidates.length; ci++) wanted[candidates[ci]] = true;
  for (var li = 0; li < layers.length; li++) {
    if (wanted[layers[li].id]) return li;
  }
  return layers.length;
}
`;

/**
 * The 3D terrain source, pointed at the tile store.
 *
 * A DEM miss is the one that shows: the page reports terrain unavailable and
 * drops the view to 2D, so the tiles belong in the Rust store, which is the
 * only tier that can be pre-seeded around a riding area and sized against the
 * one budget. Where Rust cannot be reached, the test bench, the source keeps
 * the upstream host.
 *
 * A function rather than a constant: building the page is what hands Rust the
 * upstream template.
 */
export function terrain3DSource() {
  const native = nativeTileUrl('terrain', TERRAIN_UPSTREAM_TEMPLATE);
  return {
    ...TERRAIN_3D_CONFIG.source,
    tiles: [native ?? TERRAIN_UPSTREAM_TEMPLATE],
  };
}
