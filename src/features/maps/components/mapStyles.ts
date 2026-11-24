// Shared map style definitions and constants
// All sources are commercially licensed (MIT, BSD, OGD, CC BY, Public Domain)

import {
  mapPageBaseUrl,
  nativeCompositeTileUrls,
  nativeTileUrls,
  type CompositeProvider,
} from '@/features/maps/lib/tileTransport';
import { TERRAIN_UPSTREAM_TEMPLATE } from '@/features/maps/lib/terrainTemplate';
import { EOX_S2CLOUDLESS_TEMPLATE } from '@/features/maps/lib/eoxTemplate';
import {
  BASE_MAP_ATTRIBUTION,
  CREDIT_SEPARATOR,
  MAP_SOURCE_CREDITS,
} from '@/features/maps/lib/mapSourceCredits';
import { NATURAL_EARTH_ORIGIN } from '@/features/maps/styles/liberty/sources';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';
import { GERMAN_LAND_BOXES, type GermanLandId } from '@/features/maps/lib/germanLandBoxes';

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
  | 'luxembourg'
  | 'estonia'
  | 'wallonia'
  | 'slovenia'
  | GermanLandId;

// The map zoom from which each regional imagery provider is worth requesting. Where each
// provider's imagery lies is the engine's, which answers every tile from the providers that hold it.
const REGION_MIN_ZOOM = {
  france: 8,
  usa: 10,
  spain: 8,
  austria: 8,
  netherlands: 8,
  czechia: 8,
  poland: 8,
  luxembourg: 8,
  estonia: 8,
  wallonia: 8,
  slovenia: 8,
  berlin: 10,
  bremen: 10,
  'baden-wuerttemberg': 10,
  bavaria: 10,
  brandenburg: 10,
  hesse: 10,
  'lower-saxony': 10,
  'north-rhine-westphalia': 10,
  'rhineland-palatinate': 10,
  'saxony-anhalt': 10,
  saxony: 10,
  'schleswig-holstein': 10,
  thuringia: 10,
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

/** Every provider serves JPEG, and the composite answers its tiles under that name. */
const SATELLITE_TILE_EXTENSION = 'jpg';

/**
 * The template of a Land's orthophoto service that has no tile grid in web mercator zoom
 * levels, so it is asked through WMS GetMap for each tile's bounding box instead.
 */
function wmsOrthophotoTemplate(service: string, layer: string): string {
  const query = [
    'SERVICE=WMS',
    'VERSION=1.3.0',
    'REQUEST=GetMap',
    `LAYERS=${layer}`,
    'STYLES=',
    'CRS=EPSG:3857',
    'WIDTH=256',
    'HEIGHT=256',
    'FORMAT=image/jpeg',
    'BBOX={bbox-epsg-3857}',
  ].join('&');
  return `${service}?${query}`;
}

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
    attribution: MAP_SOURCE_CREDITS.swisstopo.shortCredit,
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
  // Aragón, Catalonia, the Ebro and as far in as Valladolid. PNOA has imagery
  // for all of it and `satellite-layer-spain` sits below IGN, so IGN was asked
  // first and answered 404 over ground that was already drawn. The southern
  // boxes now stop at the Pyrenean crest, and Corsica is a box of its own
  // because nothing joins it to the mainland at that latitude.
  //
  // The Pyrenean boxes also leave out the Spanish side of the Val d'Aran and
  // Irun. IGN answers its all-white tile there at z15 or z16, measured on
  // 2026-11-20, and PNOA has imagery under it, so the boxes cut around those
  // tiles. The white tiles run along the border, so the cut is a staircase and
  // some French tiles at the border fall through to the layer beneath.
  //
  // Andorra and the Spanish Cerdanya are cut the same way, along the border.
  ign: {
    tiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS.ign.shortCredit,
    boxes: [
      [8.5, 41.33, 9.6, 43.05], // Corsica
      // Cerdagne and Roussillon as a staircase along the border: Andorra and
      // the Spanish Cerdanya below it answer a white tile or a 404.
      [1.72, 42.48, 1.82, 42.6], // Pas de la Casa to Puymorens
      [1.82, 42.46, 1.87, 42.6], // Latour-de-Carol
      [1.87, 42.435, 1.92, 42.6], // Bourg-Madame
      [1.92, 42.37, 2.12, 42.6], // Cerdagne and Eyne
      [2.12, 42.41, 2.35, 42.6], // Carlit and the Têt
      [2.35, 42.39, 2.45, 42.6], // Prats-de-Mollo
      [2.45, 42.33, 2.65, 42.6], // Vallespir
      [2.65, 42.39, 2.75, 42.6], // Arles-sur-Tech
      [2.75, 42.41, 2.85, 42.6], // Albères, west
      [2.85, 42.45, 3.05, 42.6], // Le Perthus
      [3.05, 42.41, 9.56, 42.6], // Côte Vermeille and Cerbère
      [1.72, 42.6, 9.56, 42.61], // Strip between the staircase and the Ariège boxes
      [0.55, 42.7, 0.665, 42.8], // Luchon and the Pique valley, west of the Aran ridge
      [-0.15, 42.72, 0.55, 42.8], // Gavarnie to Aragnouet
      [-1.3, 42.99, -0.75, 43.05], // Soule and Iraty
      [-0.75, 42.8, 0.665, 43.05], // Comminges and the Hautes-Pyrénées, west of the Aran ridge
      [0.665, 42.85, 0.725, 43.05], // Comminges north of the ridge, 0.665 to 0.725°E
      [0.725, 42.835, 9.56, 43.05], // Comminges north of the ridge, Fos and the east
      [0.9, 42.785, 1.1, 42.815], // The ridge's French side, 0.9 to 1.1°E
      [0.77, 42.815, 9.56, 42.835], // The ridge's French side, north of 42.815°N
      [1.1, 42.745, 9.56, 42.815], // Couserans and Aulus-les-Bains
      [1.15, 42.72, 1.33, 42.745], // Ariège, west of Ax-les-Thermes
      [1.33, 42.69, 9.56, 42.745], // Ariège, Ax-les-Thermes and east to the crest
      [1.45, 42.65, 1.6, 42.69], // Ariège's south edge, 1.45 to 1.6°E
      [1.6, 42.61, 9.56, 42.745], // Roussillon and the east end of the Ariège
      [-1.76, 43.05, 7.75, 43.35], // Béarn, Marseille and the coast to Biriatou, short of Irun
      [-5.142, 43.35, 7.75, 44.2], // Aquitaine and Provence, north of the border
      [-5.142, 44.2, 7.2, 45.818], // Dauphiné and Savoie, west of Piedmont
      [-5.142, 45.818, 7.05, 46.55], // Haute-Savoie, Chamonix and the lake shore
      [-5.142, 46.55, 6.95, 47.5], // Jura and Doubs
      [-5.142, 47.5, 7.45, 47.85], // Sundgau, west of Basel
      [-5.142, 47.85, 3.2, 51.089], // Alsace north of Switzerland, and the rest, to Lille
      // A staircase down the Saarland border: the box ran to 8.25 and credited this service over
      // Saarbrücken and Saarlouis, where it answers 404 and the global imagery draws.
      [3.2, 47.85, 8.25, 49.0], // Alsace and Lorraine, south of the German border
      [3.2, 49.0, 6.3, 50.4], // Hainaut, the Ardennes and Lorraine, below Belgium
      [6.3, 49.0, 6.55, 49.4], // Moselle, west of Saarland
      [6.55, 49.0, 6.75, 49.2], // Creutzwald
      [6.75, 49.0, 6.95, 49.15], // Forbach
      [6.95, 49.0, 7.1, 49.12], // Sarreguemines
      [7.1, 49.0, 8.25, 49.05], // Bitche and Wissembourg
    ],
  },
  // USA: USGS NAIP (Public Domain - commercial OK)
  naip: {
    tiles: [
      'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/tile/{z}/{y}/{x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 17,
    attribution: MAP_SOURCE_CREDITS.naip.shortCredit,
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
    attribution: MAP_SOURCE_CREDITS.spain.shortCredit,
    bounds: [-9.4, 36.0, 4.4, 43.8],
  },
  // Austria: basemap.at Orthophoto (CC BY 4.0 OGD Austria - commercial OK)
  // maps{1-4}.wien.gv.at subdomains have DNS issues - use maps.wien.gv.at (load-balanced)
  austria: {
    tiles: ['https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg'],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS.austria.shortCredit,
    //
    // A staircase rather than the Austrian extent. The single box held Bolzano,
    // Merano, Bormio, Budweis, Znojmo, Bratislava and Sopron, and the service
    // answers a flat 2,419-byte tile with status 200 over all of them at zoom 15,
    // so each of those drew blank over ground another provider holds.
    //
    // The boxes were first set from a probe of the service at zoom 15 on a 0.1
    // degree grid, so each edge was only as close to the border as that grid.
    // Each edge was then probed at zoom 15 tile resolution. Where the service
    // answers a tile on an edge with its flat blank tile, the edge moves inward
    // past the blank run and stops at the first imagery tile on that row or
    // column. Where the rows or columns of one box need different edges, the box
    // is split into bands, one per run, since a rectangle cannot follow a blank
    // run that differs from row to row. Imagery just beyond the border is kept
    // unless a blank tile lies between it and the box's interior on the same row
    // or column.
    boxes: [
      [14.986, 49.024, 15.073, 49.03],
      [14.975, 49.017, 15.084, 49.023],
      [14.975, 49.01, 15.084, 49.016],
      [15.118, 49.01, 15.139, 49.016],
      [14.975, 48.995, 15.15, 49.009],
      [15.261, 49.002, 15.303, 49.009],
      [15.261, 48.995, 15.314, 49.001],
      [14.964, 48.981, 15.15, 48.994],
      [15.261, 48.981, 15.35, 48.994],
      [14.953, 48.952, 15.15, 48.98],
      [15.25, 48.95, 15.35, 48.98],
      [14.964, 48.95, 15.15, 48.951],
      [14.964, 48.945, 15.512, 48.95],
      [14.964, 48.923, 15.523, 48.944],
      [14.964, 48.916, 15.556, 48.922],
      [14.964, 48.909, 15.578, 48.915],
      [14.975, 48.901, 15.633, 48.908],
      [14.964, 48.887, 15.65, 48.9],
      [14.953, 48.85, 15.65, 48.886],
      [14.953, 48.844, 15.941, 48.85],
      [14.953, 48.836, 15.963, 48.843],
      [14.953, 48.829, 15.97, 48.835],
      [14.95, 48.75, 15.97, 48.828],
      [16.524, 48.822, 16.55, 48.828],
      [16.45, 48.75, 16.479, 48.821],
      [16.513, 48.75, 16.55, 48.821],
      [16.48, 48.75, 16.512, 48.814],
      [13.75, 48.749, 13.93, 48.75],
      [14.777, 48.749, 16.303, 48.75],
      [16.326, 48.749, 16.369, 48.75],
      [16.392, 48.749, 16.699, 48.75],
      [13.75, 48.742, 13.941, 48.748],
      [14.777, 48.742, 16.743, 48.748],
      [13.75, 48.735, 13.952, 48.741],
      [14.777, 48.735, 16.765, 48.741],
      [13.75, 48.728, 13.974, 48.734],
      [14.766, 48.728, 16.776, 48.734],
      [16.865, 48.728, 16.907, 48.734],
      [13.75, 48.72, 13.985, 48.727],
      [14.755, 48.72, 16.918, 48.727],
      [13.75, 48.713, 14.018, 48.719],
      [14.744, 48.713, 16.929, 48.719],
      [13.75, 48.706, 14.029, 48.712],
      [14.73, 48.706, 16.929, 48.712],
      [13.75, 48.65, 14.03, 48.705],
      [14.73, 48.65, 16.94, 48.705],
      [13.75, 48.641, 14.073, 48.65],
      [14.426, 48.648, 14.49, 48.65],
      [14.689, 48.648, 16.94, 48.65],
      [14.426, 48.612, 14.501, 48.647],
      [14.689, 48.641, 14.699, 48.647],
      [14.7, 48.612, 16.95, 48.647],
      [13.75, 48.619, 14.062, 48.64],
      [14.502, 48.612, 14.512, 48.64],
      [14.59, 48.612, 14.633, 48.64],
      [14.513, 48.612, 14.534, 48.632],
      [14.568, 48.612, 14.589, 48.632],
      [14.535, 48.612, 14.567, 48.625],
      [14.634, 48.612, 14.655, 48.625],
      [13.75, 48.612, 14.084, 48.618],
      [14.656, 48.612, 14.666, 48.618],
      [13.75, 48.604, 14.161, 48.611],
      [14.415, 48.604, 14.677, 48.611],
      [14.7, 48.604, 16.95, 48.611],
      [13.75, 48.55, 14.21, 48.603],
      [14.38, 48.55, 14.677, 48.603],
      [14.689, 48.55, 16.95, 48.603],
      [14.678, 48.55, 14.688, 48.596],
      [13.45, 48.51, 13.677, 48.55],
      [13.722, 48.51, 16.95, 48.55],
      [13.678, 48.51, 13.688, 48.545],
      [13.689, 48.51, 13.71, 48.538],
      [13.711, 48.51, 13.721, 48.531],
      [13.45, 48.488, 16.94, 48.509],
      [13.45, 48.481, 16.929, 48.487],
      [13.45, 48.466, 16.907, 48.48],
      [13.45, 48.459, 16.896, 48.465],
      [13.45, 48.444, 16.885, 48.458],
      [13.45, 48.43, 16.875, 48.443],
      [13.45, 48.408, 16.885, 48.429],
      [13.45, 48.379, 16.875, 48.407],
      [13.45, 48.364, 16.864, 48.378],
      [13.45, 48.357, 16.885, 48.363],
      [13.45, 48.35, 16.896, 48.356],
      [13.338, 48.349, 16.896, 48.35],
      [13.327, 48.342, 16.896, 48.348],
      [13.15, 48.335, 16.918, 48.341],
      [13.15, 48.313, 16.929, 48.334],
      [13.15, 48.298, 16.918, 48.312],
      [13.15, 48.291, 16.929, 48.297],
      [13.15, 48.284, 16.94, 48.29],
      [13.15, 48.25, 16.95, 48.283],
      [12.986, 48.247, 16.95, 48.25],
      [12.85, 48.218, 16.95, 48.246],
      [12.855, 48.211, 16.95, 48.217],
      [12.85, 48.15, 16.95, 48.21],
      [12.778, 48.145, 16.97, 48.15],
      [12.75, 48.1, 16.97, 48.144],
      [12.75, 48.086, 17.116, 48.1],
      [12.75, 48.049, 17.105, 48.085],
      [12.778, 48.042, 17.105, 48.048],
      [12.75, 48.035, 17.138, 48.041],
      [12.75, 47.983, 17.15, 48.034],
      [12.75, 47.976, 17.138, 47.982],
      [12.75, 47.968, 17.127, 47.975],
      [12.855, 47.961, 17.138, 47.967],
      [12.75, 47.954, 17.138, 47.96],
      [12.75, 47.895, 17.127, 47.953],
      [12.75, 47.88, 17.116, 47.894],
      [12.75, 47.865, 17.105, 47.879],
      [12.975, 47.858, 17.072, 47.864],
      [12.975, 47.851, 17.05, 47.857],
      [12.975, 47.836, 13.45, 47.85],
      [13.55, 47.75, 17.05, 47.85],
      [12.95, 47.75, 13.45, 47.835],
      [12.15, 47.74, 12.45, 47.75],
      [13.05, 47.703, 16.55, 47.75],
      [16.75, 47.688, 17.05, 47.75],
      [12.217, 47.732, 12.45, 47.739],
      [12.206, 47.725, 12.45, 47.731],
      [12.184, 47.718, 12.45, 47.724],
      [12.15, 47.65, 12.45, 47.717],
      [13.05, 47.695, 16.545, 47.702],
      [13.05, 47.688, 16.512, 47.694],
      [13.052, 47.681, 16.501, 47.687],
      [16.75, 47.681, 16.995, 47.687],
      [13.063, 47.658, 16.49, 47.68],
      [16.75, 47.673, 16.842, 47.68],
      [16.865, 47.673, 16.94, 47.68],
      [16.75, 47.666, 16.798, 47.672],
      [13.063, 47.651, 16.534, 47.657],
      [11.85, 47.644, 12.502, 47.65],
      [12.525, 47.644, 12.788, 47.65],
      [13.074, 47.629, 16.55, 47.65],
      [11.85, 47.636, 12.81, 47.643],
      [12.184, 47.629, 12.85, 47.635],
      [11.85, 47.592, 12.85, 47.628],
      [13.063, 47.621, 16.55, 47.628],
      [13.052, 47.614, 16.55, 47.62],
      [9.75, 47.607, 9.799, 47.613],
      [13.05, 47.45, 16.55, 47.613],
      [9.75, 47.55, 9.85, 47.606],
      [11.85, 47.562, 12.81, 47.591],
      [11.85, 47.55, 12.85, 47.561],
      [9.636, 47.547, 10.05, 47.55],
      [10.45, 47.54, 10.513, 47.55],
      [10.558, 47.54, 10.95, 47.55],
      [11.35, 47.547, 12.95, 47.55],
      [9.614, 47.54, 10.05, 47.546],
      [10.514, 47.54, 10.557, 47.546],
      [11.35, 47.54, 12.864, 47.546],
      [9.603, 47.525, 10.05, 47.539],
      [10.45, 47.533, 10.777, 47.539],
      [10.8, 47.533, 10.909, 47.539],
      [11.35, 47.533, 12.886, 47.539],
      [10.45, 47.503, 10.95, 47.532],
      [11.35, 47.525, 12.897, 47.532],
      [9.55, 47.436, 9.591, 47.524],
      [9.592, 47.443, 9.602, 47.524],
      [9.603, 47.436, 10.05, 47.524],
      [11.35, 47.518, 12.95, 47.524],
      [11.404, 47.51, 12.95, 47.517],
      [11.35, 47.45, 12.95, 47.509],
      [10.45, 47.495, 10.92, 47.502],
      [10.45, 47.45, 10.95, 47.494],
      [10.45, 47.391, 16.55, 47.45],
      [9.581, 47.429, 10.05, 47.435],
      [9.603, 47.414, 10.05, 47.428],
      [9.581, 47.391, 10.05, 47.413],
      [9.57, 47.377, 10.05, 47.39],
      [10.45, 47.384, 16.523, 47.39],
      [10.45, 47.377, 16.512, 47.383],
      [9.55, 47.35, 10.05, 47.376],
      [10.45, 47.362, 16.479, 47.376],
      [10.45, 47.35, 16.468, 47.361],
      [9.55, 47.347, 10.338, 47.35],
      [10.35, 47.347, 16.468, 47.35],
      [9.55, 47.332, 16.479, 47.346],
      [9.55, 47.31, 16.49, 47.331],
      [9.55, 47.287, 10.217, 47.309],
      [10.218, 47.295, 10.228, 47.309],
      [10.229, 47.287, 16.501, 47.309],
      [9.55, 47.272, 16.512, 47.286],
      [9.55, 47.25, 16.501, 47.271],
      [9.55, 47.15, 16.45, 47.25],
      [9.55, 47.123, 16.545, 47.15],
      [9.57, 47.115, 16.545, 47.122],
      [9.57, 47.108, 16.523, 47.114],
      [9.55, 47.101, 16.523, 47.107],
      [9.55, 47.093, 16.501, 47.1],
      [9.55, 47.086, 16.49, 47.092],
      [9.55, 47.078, 16.512, 47.085],
      [9.55, 47.063, 12.161, 47.077],
      [12.162, 47.071, 12.183, 47.077],
      [12.195, 47.063, 16.534, 47.077],
      [9.55, 47.056, 12.095, 47.062],
      [12.195, 47.056, 16.545, 47.062],
      [9.55, 47.05, 12.095, 47.055],
      [12.195, 47.05, 16.534, 47.055],
      [9.75, 46.981, 11.48, 47.05],
      [11.481, 46.988, 11.491, 47.05],
      [11.492, 46.996, 11.502, 47.05],
      [11.503, 46.988, 11.513, 47.05],
      [11.514, 46.981, 11.59, 47.05],
      [11.591, 46.988, 11.601, 47.05],
      [11.602, 46.996, 11.623, 47.05],
      [11.624, 46.988, 11.645, 47.05],
      [11.646, 46.981, 11.85, 47.05],
      [12.195, 47.041, 16.534, 47.05],
      [12.15, 47.033, 16.512, 47.04],
      [12.15, 47.026, 16.501, 47.032],
      [12.15, 47.018, 16.512, 47.025],
      [12.15, 47.011, 16.523, 47.017],
      [12.15, 46.996, 16.534, 47.01],
      [12.15, 46.988, 16.523, 46.995],
      [12.15, 46.981, 16.303, 46.987],
      [16.326, 46.981, 16.347, 46.987],
      [16.414, 46.981, 16.501, 46.987],
      [9.75, 46.966, 11.293, 46.98],
      [11.294, 46.973, 11.359, 46.98],
      [11.36, 46.966, 11.458, 46.98],
      [11.459, 46.973, 11.469, 46.98],
      [11.514, 46.973, 11.557, 46.98],
      [11.701, 46.973, 11.711, 46.98],
      [11.712, 46.966, 11.788, 46.98],
      [12.15, 46.951, 16.292, 46.98],
      [9.75, 46.958, 11.26, 46.965],
      [11.371, 46.958, 11.447, 46.965],
      [11.712, 46.958, 11.777, 46.965],
      [9.75, 46.951, 11.228, 46.957],
      [11.393, 46.951, 11.425, 46.957],
      [9.95, 46.85, 10.25, 46.95],
      [10.45, 46.913, 11.15, 46.95],
      [12.15, 46.898, 16.15, 46.95],
      [10.45, 46.906, 11.129, 46.912],
      [10.45, 46.876, 11.118, 46.905],
      [12.151, 46.891, 16.15, 46.897],
      [12.184, 46.876, 16.15, 46.89],
      [10.45, 46.861, 11.107, 46.875],
      [12.195, 46.861, 12.238, 46.875],
      [12.239, 46.868, 12.249, 46.875],
      [12.261, 46.861, 16.15, 46.875],
      [10.45, 46.85, 10.623, 46.86],
      [10.624, 46.853, 10.678, 46.86],
      [10.679, 46.85, 11.096, 46.86],
      [12.272, 46.838, 16.15, 46.86],
      [10.75, 46.77, 10.766, 46.85],
      [10.767, 46.778, 10.788, 46.85],
      [10.789, 46.77, 11.05, 46.85],
      [12.272, 46.831, 16.083, 46.837],
      [12.272, 46.823, 16.072, 46.83],
      [12.261, 46.808, 16.018, 46.822],
      [12.272, 46.801, 16.018, 46.807],
      [12.261, 46.786, 16.018, 46.8],
      [12.261, 46.778, 16.007, 46.785],
      [12.272, 46.77, 16.007, 46.777],
      [10.8, 46.763, 11.041, 46.769],
      [12.327, 46.763, 16.007, 46.769],
      [10.855, 46.755, 10.92, 46.762],
      [10.965, 46.755, 11.041, 46.762],
      [12.338, 46.755, 16.007, 46.762],
      [10.866, 46.75, 10.898, 46.754],
      [12.349, 46.75, 16.007, 46.754],
      [12.36, 46.71, 15.75, 46.75],
      [15.95, 46.74, 16.007, 46.75],
      [15.95, 46.733, 16.018, 46.739],
      [15.95, 46.725, 16.029, 46.732],
      [15.95, 46.673, 16.05, 46.724],
      [12.371, 46.703, 15.75, 46.709],
      [12.382, 46.695, 15.75, 46.702],
      [12.404, 46.688, 15.75, 46.694],
      [12.415, 46.68, 15.666, 46.687],
      [15.711, 46.68, 15.732, 46.687],
      [12.437, 46.673, 15.655, 46.679],
      [12.459, 46.665, 15.589, 46.672],
      [15.601, 46.665, 15.644, 46.672],
      [15.986, 46.665, 16.05, 46.672],
      [12.514, 46.657, 15.75, 46.664],
      [15.95, 46.65, 16.05, 46.664],
      [12.525, 46.65, 15.75, 46.656],
      [12.83, 46.635, 15.05, 46.65],
      [12.83, 46.62, 15.029, 46.634],
      [12.83, 46.605, 15.018, 46.619],
      [12.83, 46.597, 15.05, 46.604],
      [12.844, 46.59, 12.864, 46.596],
      [12.931, 46.59, 15.05, 46.596],
      [13.019, 46.582, 13.073, 46.589],
      [13.085, 46.582, 15.05, 46.589],
      [13.118, 46.574, 15.05, 46.581],
      [13.162, 46.567, 15.05, 46.573],
      [13.173, 46.559, 15.05, 46.566],
      [13.206, 46.552, 13.381, 46.558],
      [13.393, 46.552, 15.05, 46.558],
      [13.217, 46.55, 13.348, 46.551],
      [13.404, 46.55, 15.05, 46.551],
      [13.75, 46.45, 13.85, 46.55],
      [13.95, 46.45, 14.85, 46.55],
      [14.45, 46.35, 14.65, 46.45],
    ],
  },
  // Netherlands: PDOK Luchtfoto (CC BY 4.0 Kadaster - commercial OK)
  netherlands: {
    tiles: [
      'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 21,
    attribution: MAP_SOURCE_CREDITS.netherlands.shortCredit,
    // A staircase down the Belgian border. The single box ran south to 50.75
    // from 3.37E, which holds Brussels, Antwerp and Ghent, and PDOK answers
    // nothing over them.
    boxes: [
      [3.37, 51.2, 4.2, 51.5], // Zeeuws-Vlaanderen
      [4.2, 51.45, 5.6, 53.55], // Zeeland, Brabant and the north
      [5.6, 50.75, 7.21, 53.55], // Limburg and the east
    ],
  },
  // Czech Republic: CUZK Orthophoto (CC BY 4.0 since July 2023 - commercial OK)
  czechia: {
    tiles: [
      'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile/1.0.0/ORTOFOTO_WM/default/GoogleMapsCompatible/{z}/{y}/{x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 18,
    attribution: MAP_SOURCE_CREDITS.czechia.shortCredit,
    bounds: [12.09, 48.55, 18.85, 51.06],
  },
  // Poland: GUGiK Orthophoto (free for all use, Art. 40a Geodetic Law 2020 - commercial OK)
  poland: {
    tiles: [
      'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 19,
    attribution: MAP_SOURCE_CREDITS.poland.shortCredit,
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
    attribution: MAP_SOURCE_CREDITS.luxembourg.shortCredit,
    // The service answers a 1,651-byte white tile, not a 404, over the Belgian and French
    // ground beside Luxembourg, so the boxes stop at the border. Each west edge is the first
    // zoom 16 tile of its rows that the service fills, and each east edge the last one. Boxes
    // are merged while no row in them loses more than about 0.03 degrees to the box. The east
    // edges are measured where the German border runs; Rhineland-Palatinate draws above
    // Luxembourg there.
    boxes: [
      [5.9889, 50.1593, 6.0246, 50.1734],
      [5.9669, 50.1523, 6.0411, 50.1593],
      [5.9669, 50.1347, 6.107, 50.1487],
      [5.9615, 50.1276, 6.107, 50.1347],
      [5.9395, 50.1206, 6.129, 50.1276],
      [5.923, 50.0783, 6.118, 50.1206],
      [5.89, 50.0501, 6.1125, 50.0783],
      [5.8736, 50.0219, 6.118, 50.0501],
      [5.8571, 49.9936, 6.129, 50.0219],
      [5.8406, 49.9618, 6.151, 49.9936],
      [5.7802, 49.9512, 6.1729, 49.9618],
      [5.7802, 49.9194, 6.2114, 49.9512],
      [5.7637, 49.8911, 6.2169, 49.9194],
      [5.7857, 49.8769, 6.2444, 49.8911],
      [5.7857, 49.8663, 6.2828, 49.8769],
      [5.7637, 49.838, 6.3103, 49.8663],
      [5.7527, 49.8309, 6.3762, 49.838],
      [5.7527, 49.8167, 6.3817, 49.8309],
      [5.7527, 49.8096, 6.4256, 49.8167],
      [5.7527, 49.8061, 6.5025, 49.8096],
      [5.7802, 49.7954, 6.5025, 49.8061],
      [5.8186, 49.76, 6.5025, 49.7954],
      [5.8351, 49.7245, 6.4915, 49.76],
      [5.89, 49.7067, 6.4861, 49.7245],
      [5.8846, 49.6925, 6.4586, 49.7067],
      [5.8846, 49.6747, 6.4366, 49.6925],
      [5.912, 49.6463, 6.4256, 49.6747],
      [5.9065, 49.6143, 6.4146, 49.6463],
      [5.8791, 49.6, 6.3817, 49.6143],
      [5.8736, 49.5787, 6.3707, 49.6],
      [5.8736, 49.568, 6.3542, 49.5787],
      [5.8681, 49.5537, 6.3597, 49.568],
      [5.8406, 49.5466, 6.3762, 49.5537],
      [5.8461, 49.5252, 6.3542, 49.5466],
      [5.8791, 49.5216, 6.3542, 49.5252],
      [5.8406, 49.5181, 6.3597, 49.5216],
      [5.8791, 49.5109, 6.3597, 49.5181],
      [5.89, 49.4967, 6.151, 49.5109],
      [5.9779, 49.4931, 6.1455, 49.4967],
      [5.9779, 49.4788, 6.118, 49.4931],
      [5.9779, 49.4681, 6.096, 49.4788],
      [5.9889, 49.4574, 6.0411, 49.4681],
    ],
  },
  // Estonia: orthophoto of the Republic of Estonia Land and Spatial Development Board
  // (Maa- ja Ruumiamet), open data licence (commercial use permitted, attribution required).
  // Over Riga the service answers a 116-byte blank PNG with status 200, not a 404,
  // so the boxes stop short of the Latvian and Russian borders and of the Finnish
  // coast. They are drawn from named places inside the border, not from a boundary
  // dataset, so the margin is a few kilometres on each side. Parts of the south-east
  // corner, Ruhnu and Narva are left to the global imagery as a result. The GMC
  // matrix set has no level past 18.
  estonia: {
    tiles: ['https://tiles.maaamet.ee/tm/wmts/1.0.0/foto/default/GMC/{z}/{y}/{x}.jpg'],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 18,
    attribution: MAP_SOURCE_CREDITS.estonia.shortCredit,
    boxes: [
      [21.7, 57.95, 23.5, 59.3], // Saaremaa, Hiiumaa and the western islands
      [23.5, 58.05, 26.0, 59.65], // Pärnu, Tallinn and the north-western coast
      [26.0, 57.9, 27.2, 59.3], // Tartu, Otepää and the south-east, north of Valga
      [26.0, 59.3, 27.0, 59.65], // Rakvere, Tapa and the north-east
      [27.0, 59.33, 27.7, 59.65], // Jõhvi and the north-east county
    ],
  },
  // Wallonia: SPW Orthophotos (CC BY 4.0 with the source named - commercial OK)
  //
  // The service's own tile grid is Belgian Lambert 72, so only its WMS serves
  // web-mercator tiles, by the tile's bounding box. Its metadata sets no
  // maximum scale; the imagery is flown at 25 cm, which a 256-pixel tile
  // resolves at tile zoom 19.
  //
  // A staircase along the French, Luxembourg and German borders and the
  // Flemish and Brussels edge. It sits beneath Luxembourg and the Netherlands,
  // which hold the ground their boxes reach, and above IGN, whose boxes run on
  // to the north-east corner of France and would otherwise answer 404 over
  // Belgium.
  wallonia: {
    tiles: [
      'https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX={bbox-epsg-3857}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 19,
    attribution: MAP_SOURCE_CREDITS.wallonia.shortCredit,
    boxes: [
      [2.95, 50.72, 3.2, 50.8], // Comines-Warneton
      [3.2, 50.58, 3.6, 50.76], // Mouscron and Tournai
      [3.6, 50.42, 3.9, 50.76], // Péruwelz and Ath
      [3.9, 50.33, 4.25, 50.76], // Mons and Binche
      [4.25, 50.0, 4.6, 50.74], // Charleroi, Chimay and the Brabant Walloon
      [4.6, 50.02, 4.8, 50.74], // Gembloux and the Viroin
      [4.8, 50.15, 5.05, 50.74], // Namur and Dinant
      [4.9, 49.9, 5.05, 50.15], // Gedinne
      [5.05, 49.74, 5.3, 50.74], // Bouillon and the Hesbaye
      [5.3, 49.5, 5.73, 50.74], // Liège, Virton and Bastogne
      [5.73, 50.18, 6.15, 50.74], // Malmedy, Spa and Eupen, north of Luxembourg
      [6.15, 50.2, 6.4, 50.5], // The Eastern Cantons
    ],
  },
  // Slovenia: GURS DOF025 orthophoto over its WMS (CC BY 4.0 - commercial OK)
  //
  // The service answers a blank 200 outside its data, so the boxes are a
  // staircase that stops at the Italian, Austrian, Croatian and Hungarian
  // borders. It is listed above Austria in the stack: Austria's box reaches
  // south to 46.37 and holds Kranjska Gora and Maribor, which Slovenia must
  // draw. The WMS names no tile grid, so the engine fills the bbox
  // placeholder with each tile's edges.
  slovenia: {
    tiles: [
      'https://ipi.eprostor.gov.si/wms-si-gurs-dts/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=SI.GURS.ZPDZ:DOF025_3857&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX={bbox-epsg-3857}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS.slovenia.shortCredit,
    boxes: [
      [13.58, 45.47, 13.88, 45.6], // The coast around Koper
      [13.88, 45.5, 14.0, 45.75], // The Karst, east of Trieste
      [13.7, 45.75, 14.0, 45.9], // The Vipava valley
      [13.63, 45.9, 14.0, 46.0], // Nova Gorica, beside Gorizia
      [13.5, 46.0, 14.0, 46.38], // The Soča valley, east of Italy
      [13.7, 46.38, 14.0, 46.5], // Kranjska Gora, south of the Karawanks
      [14.0, 45.5, 14.55, 46.48], // Ljubljana and the Karawanks, south of Klagenfurt
      [14.55, 45.62, 14.7, 46.48], // Beside the Čabranka, north of Čabar
      [14.7, 45.45, 15.1, 46.6], // Kočevje and the Savinja Alps
      [15.1, 45.5, 15.3, 46.66], // Bela krajina and Celje, north of the Kolpa
      [15.3, 45.62, 15.45, 46.66], // Metlika, north of the Kolpa
      [15.45, 45.78, 15.58, 46.66], // The Gorjanci ridge
      [15.58, 45.84, 15.72, 46.66], // Brežice, Maribor and the Sutla
      [15.72, 46.3, 16.1, 46.66], // Ptuj and Ljutomer
      [16.1, 46.4, 16.62, 46.88], // Prekmurje
    ],
  },
  // Berlin: TrueDOP 2024 (dl-de/zero-2.0 - commercial OK, no attribution required)
  berlin: {
    tiles: [
      wmsOrthophotoTemplate('https://gdi.berlin.de/services/wms/truedop_2024', 'truedop_2024'),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['berlin'].shortCredit,
    boxes: GERMAN_LAND_BOXES['berlin'],
  },
  // Bremen: DOP20 2023, boxed to the city of Bremen (CC BY 4.0 - commercial OK)
  bremen: {
    tiles: [wmsOrthophotoTemplate('https://geodienste.bremen.de/wms_dop20_2023', 'DOP20_2023_HB')],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['bremen'].shortCredit,
    boxes: GERMAN_LAND_BOXES['bremen'],
  },
  // Baden-Württemberg: LGL-BW DOP20 (dl-de/by-2.0 - commercial OK)
  'baden-wuerttemberg': {
    tiles: [
      wmsOrthophotoTemplate(
        'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C',
        'IMAGES_DOP_20_RGB'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['baden-wuerttemberg'].shortCredit,
    boxes: GERMAN_LAND_BOXES['baden-wuerttemberg'],
  },
  // Bavaria: DOP40 (CC BY 4.0 - commercial OK)
  bavaria: {
    tiles: [
      wmsOrthophotoTemplate('https://geoservices.bayern.de/od/wms/dop/v1/dop40', 'by_dop40c'),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['bavaria'].shortCredit,
    boxes: GERMAN_LAND_BOXES['bavaria'],
  },
  // Brandenburg: LGB DOP20 (dl-de/by-2.0 - commercial OK)
  brandenburg: {
    tiles: [
      wmsOrthophotoTemplate(
        'https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms',
        'bebb_dop20c'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['brandenburg'].shortCredit,
    boxes: GERMAN_LAND_BOXES['brandenburg'],
  },
  // Hesse: DOP20 (HVGG §§ 18 and 24 permit any use - commercial OK)
  hesse: {
    tiles: [
      wmsOrthophotoTemplate(
        'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
        'he_dop20_rgb'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['hesse'].shortCredit,
    boxes: GERMAN_LAND_BOXES['hesse'],
  },
  // Lower Saxony: LGLN DOP20 (CC BY 4.0 - commercial OK); the Bremerhaven exclave is blank
  'lower-saxony': {
    tiles: [
      wmsOrthophotoTemplate(
        'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms',
        'ni_dop20'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['lower-saxony'].shortCredit,
    boxes: GERMAN_LAND_BOXES['lower-saxony'],
  },
  // North Rhine-Westphalia: DOP (dl-de/zero-2.0 - commercial OK)
  'north-rhine-westphalia': {
    tiles: [wmsOrthophotoTemplate('https://www.wms.nrw.de/geobasis/wms_nw_dop', 'nw_dop_rgb')],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['north-rhine-westphalia'].shortCredit,
    boxes: GERMAN_LAND_BOXES['north-rhine-westphalia'],
  },
  // Rhineland-Palatinate: DOP20 (dl-de/by-2.0 - commercial OK)
  'rhineland-palatinate': {
    tiles: [wmsOrthophotoTemplate('https://geo4.service24.rlp.de/wms/rp_dop20.fcgi', 'rp_dop20')],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['rhineland-palatinate'].shortCredit,
    boxes: GERMAN_LAND_BOXES['rhineland-palatinate'],
  },
  // Saxony-Anhalt: LVermGeo DOP20 (dl-de/by-2.0 per the Land's open-data terms - commercial OK)
  'saxony-anhalt': {
    tiles: [
      wmsOrthophotoTemplate(
        'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest',
        'lsa_lvermgeo_dop20_2'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['saxony-anhalt'].shortCredit,
    boxes: GERMAN_LAND_BOXES['saxony-anhalt'],
  },
  // Saxony: GeoSN DOP20 (SächsGDNutzVO unrestricted reuse, dl-de/by-2.0 form - commercial OK)
  saxony: {
    tiles: [
      wmsOrthophotoTemplate('https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest', 'sn_dop_020'),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['saxony'].shortCredit,
    boxes: GERMAN_LAND_BOXES['saxony'],
  },
  // Schleswig-Holstein: DOP20 (CC BY 4.0 - commercial OK)
  'schleswig-holstein': {
    tiles: [
      wmsOrthophotoTemplate('https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD', 'sh_dop20_rgb'),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['schleswig-holstein'].shortCredit,
    boxes: GERMAN_LAND_BOXES['schleswig-holstein'],
  },
  // Thuringia: DOP20 (CC BY 4.0 - commercial OK)
  thuringia: {
    tiles: [
      wmsOrthophotoTemplate(
        'https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20',
        'th_dop'
      ),
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS['thuringia'].shortCredit,
    boxes: GERMAN_LAND_BOXES['thuringia'],
  },
  // Global fallback: EOX Sentinel-2 2016/2017 (CC BY 4.0 - commercial OK)
  // Note: 2018+ versions are CC BY-NC-SA (not commercial)
  eox: {
    tiles: [EOX_S2CLOUDLESS_TEMPLATE],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 14,
    attribution: MAP_SOURCE_CREDITS.eox.shortCredit,
    // No bounds - global coverage
  },
};

// The combined satellite MapLibre style: two composite raster sources.
interface CombinedSatelliteMapStyle {
  version: 8;
  glyphs?: string;
  sources: Record<
    string,
    {
      type: 'raster';
      tiles: string[];
      tileSize: number;
      minzoom?: number;
      maxzoom: number;
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

/** The source name of a regional provider in the engine's tile store. */
function providerName(id: SatelliteSourceId): string {
  return `satellite-${id}`;
}

/**
 * The regional providers, topmost first: where two cover the same ground the
 * first listed draws. Each draws from its own map zoom, which is when its
 * imagery is worth the request. The global provider sits under all of them.
 */
const REGIONAL_STACK: { id: SatelliteSourceId; minZoom: number }[] = [
  { id: 'swisstopo', minZoom: 8 },
  { id: 'berlin', minZoom: REGION_MIN_ZOOM['berlin'] },
  { id: 'bremen', minZoom: REGION_MIN_ZOOM['bremen'] },
  { id: 'baden-wuerttemberg', minZoom: REGION_MIN_ZOOM['baden-wuerttemberg'] },
  { id: 'bavaria', minZoom: REGION_MIN_ZOOM['bavaria'] },
  { id: 'brandenburg', minZoom: REGION_MIN_ZOOM['brandenburg'] },
  { id: 'hesse', minZoom: REGION_MIN_ZOOM['hesse'] },
  { id: 'lower-saxony', minZoom: REGION_MIN_ZOOM['lower-saxony'] },
  { id: 'north-rhine-westphalia', minZoom: REGION_MIN_ZOOM['north-rhine-westphalia'] },
  { id: 'rhineland-palatinate', minZoom: REGION_MIN_ZOOM['rhineland-palatinate'] },
  { id: 'saxony-anhalt', minZoom: REGION_MIN_ZOOM['saxony-anhalt'] },
  { id: 'saxony', minZoom: REGION_MIN_ZOOM['saxony'] },
  { id: 'schleswig-holstein', minZoom: REGION_MIN_ZOOM['schleswig-holstein'] },
  { id: 'thuringia', minZoom: REGION_MIN_ZOOM['thuringia'] },
  { id: 'luxembourg', minZoom: REGION_MIN_ZOOM.luxembourg },
  { id: 'slovenia', minZoom: REGION_MIN_ZOOM.slovenia },
  { id: 'austria', minZoom: REGION_MIN_ZOOM.austria },
  { id: 'netherlands', minZoom: REGION_MIN_ZOOM.netherlands },
  { id: 'wallonia', minZoom: REGION_MIN_ZOOM.wallonia },
  { id: 'czechia', minZoom: REGION_MIN_ZOOM.czechia },
  { id: 'naip', minZoom: REGION_MIN_ZOOM.usa },
  { id: 'ign', minZoom: REGION_MIN_ZOOM.france },
  { id: 'poland', minZoom: REGION_MIN_ZOOM.poland },
  { id: 'spain', minZoom: REGION_MIN_ZOOM.spain },
  { id: 'estonia', minZoom: REGION_MIN_ZOOM.estonia },
];

/**
 * The source that draws the whole range. Rust answers each of its tiles from
 * the topmost regional provider that holds it, and from the global imagery
 * where none does. Its `maxzoom` is the global imagery's, which MapLibre
 * stretches past that.
 */
const SATELLITE_GLOBAL_SOURCE = 'satellite-global';

/**
 * The source that draws deeper than the global imagery goes. Rust answers each
 * of its tiles from the regional providers alone, and a tile no region holds is
 * a 404 the layer beneath covers.
 */
const SATELLITE_REGIONS_SOURCE = 'satellite-regions';

/** MapLibre asks for tile zoom = map zoom + this, for the declared tile size. */
const TILE_ZOOM_OFFSET = Math.log2(512 / SATELLITE_TILE_SIZE);

/** The deepest tile zoom the global imagery serves. */
const GLOBAL_MAXZOOM = SATELLITE_SOURCES.eox.maxzoom;

/** The first tile zoom only the regional providers can draw. */
const REGIONS_MINZOOM = GLOBAL_MAXZOOM + 1;

/** The map zoom at which MapLibre first asks the regions source for a tile. */
const REGIONS_LAYER_MINZOOM = REGIONS_MINZOOM - TILE_ZOOM_OFFSET;

function regionalProvider(id: SatelliteSourceId, minZoom: number): CompositeProvider {
  const source = SATELLITE_SOURCES[id];
  const [template] = source.tiles;
  if (!template) throw new Error(`Satellite source ${id} names no tile template`);
  return {
    source: providerName(id),
    template,
    minZoom,
    maxZoom: source.maxzoom,
    boxes: source.boxes ?? (source.bounds ? [source.bounds] : []),
  };
}

/** What a composite source of the satellite style answers from, in priority order. */
export function satelliteProviders(name: string): CompositeProvider[] {
  if (name === SATELLITE_REGIONS_SOURCE) {
    return REGIONAL_STACK.map(({ id, minZoom }) =>
      regionalProvider(id, Math.max(minZoom + TILE_ZOOM_OFFSET, REGIONS_MINZOOM))
    );
  }
  if (name === SATELLITE_GLOBAL_SOURCE) {
    return [
      ...REGIONAL_STACK.map(({ id, minZoom }) => regionalProvider(id, minZoom + TILE_ZOOM_OFFSET)),
      { ...regionalProvider('eox', 0), boxes: [] },
    ];
  }
  return [];
}

export function getCombinedSatelliteStyle(): CombinedSatelliteMapStyle {
  const regionsMaxzoom = Math.max(
    ...satelliteProviders(SATELLITE_REGIONS_SOURCE).map((p) => p.maxZoom)
  );
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    // Each source's `tiles` is the global imagery's upstream template, which
    // is what a page with no engine behind it draws. The engine's URLs
    // replace it in `rewriteSatelliteUrls`.
    sources: {
      [SATELLITE_GLOBAL_SOURCE]: {
        type: 'raster',
        tiles: SATELLITE_SOURCES.eox.tiles,
        tileSize: SATELLITE_TILE_SIZE,
        maxzoom: GLOBAL_MAXZOOM,
      },
      [SATELLITE_REGIONS_SOURCE]: {
        type: 'raster',
        tiles: SATELLITE_SOURCES.eox.tiles,
        tileSize: SATELLITE_TILE_SIZE,
        minzoom: REGIONS_MINZOOM,
        maxzoom: regionsMaxzoom,
      },
    },
    layers: [
      // Dark background so empty tile areas show dark blue instead of white
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0a1628' },
      },
      {
        id: 'satellite-layer-global',
        type: 'raster',
        source: SATELLITE_GLOBAL_SOURCE,
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: 'satellite-layer-regions',
        type: 'raster',
        source: SATELLITE_REGIONS_SOURCE,
        minzoom: REGIONS_LAYER_MINZOOM,
        maxzoom: 22,
      },
    ],
  };
}

/**
 * The satellite sources whose 404 is a tile outside every region's coverage.
 * The global layer beneath still draws there, so such a 404 leaves no hole in
 * the picture.
 */
export function regionalSatelliteSourceIds(): string[] {
  return [SATELLITE_REGIONS_SOURCE];
}

// Check if a style should use dark UI elements
export function isDarkStyle(style: MapStyleType): boolean {
  return style === 'dark' || style === 'satellite';
}

/** The status bar glyphs over a full-bleed map: they contrast with the style drawn beneath. */
export function statusBarStyleForMap(style: MapStyleType): 'light' | 'dark' {
  return isDarkStyle(style) ? 'light' : 'dark';
}

// Satellite is skipped while it cannot be drawn, so a tap always changes the basemap
export function getNextStyle(
  current: MapStyleType,
  { satellite }: { satellite: boolean }
): MapStyleType {
  if (current === 'light') return 'dark';
  if (current === 'dark') return satellite ? 'satellite' : 'light';
  return 'light';
}

// The toggle's glyph names the style a tap draws, so it takes that style
export function getStyleIcon(
  target: MapStyleType
): 'weather-night' | 'satellite-variant' | 'weather-sunny' {
  if (target === 'dark') return 'weather-night';
  if (target === 'satellite') return 'satellite-variant';
  return 'weather-sunny';
}

// Attribution text for each map source
export const MAP_ATTRIBUTIONS: Record<MapStyleType, string> = {
  light: BASE_MAP_ATTRIBUTION,
  dark: BASE_MAP_ATTRIBUTION,
  satellite: MAP_SOURCE_CREDITS.eox.shortCredit, // Default, updated dynamically
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

/** The satellite raster stack, top down, with the global imagery at the bottom. */
function satelliteLayerStack(): { id: SatelliteSourceId; minzoom: number }[] {
  return [
    ...REGIONAL_STACK.map(({ id, minZoom }) => ({ id, minzoom: minZoom })),
    { id: 'eox', minzoom: 0 },
  ];
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
    .join(CREDIT_SEPARATOR);
}

/**
 * Point every satellite raster at the tile store.
 *
 * Each source's upstream template goes to Rust once and the page asks the
 * store's own URLs, so the store answers a hit and fills a miss without the page
 * knowing which happened. Where Rust cannot be reached, which is the test
 * bench, a source keeps its upstream URL.
 */
export function rewriteSatelliteUrls(style: CombinedSatelliteMapStyle): CombinedSatelliteMapStyle {
  const rewritten: CombinedSatelliteMapStyle = JSON.parse(JSON.stringify(style));
  for (const [key, source] of Object.entries(rewritten.sources)) {
    const native = nativeCompositeTileUrls(key, satelliteProviders(key), SATELLITE_TILE_EXTENSION);
    if (native) {
      source.tiles = native;
    } else if (key === SATELLITE_REGIONS_SOURCE) {
      // Only the engine can choose a region's tiles, so without it the global
      // imagery is all there is to draw.
      delete rewritten.sources[key];
      rewritten.layers = rewritten.layers.filter(
        (layer) => !('source' in layer) || layer.source !== key
      );
    }
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
    const native = nativeTileUrls(key, tiles[0]);
    if (native) source.tiles = native;
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
        const native = nativeTileUrls(key, source.url, 'pbf');
        if (native) {
          source.tiles = native;
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
export const TERRAIN_ATTRIBUTION = MAP_SOURCE_CREDITS.terrain.shortCredit;

/**
 * Shared 3D terrain configuration - single source of truth for both
 * MapSurface (interactive detail) and TerrainSnapshotWebView (feed previews).
 * The sky and the hillshade colours belong to the base map, so they come from
 * its palette through `terrain3DPaint`.
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
  /** The tilt a map eases to when terrain comes on, in degrees from straight down. */
  defaultPitch: 60,
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
  const native = nativeTileUrls('terrain', TERRAIN_UPSTREAM_TEMPLATE);
  return {
    ...TERRAIN_3D_CONFIG.source,
    tiles: native ?? [TERRAIN_UPSTREAM_TEMPLATE],
  };
}
