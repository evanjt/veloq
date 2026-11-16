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
import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';
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
  // Estonia
  estonia: {
    minLat: 57.9,
    maxLat: 59.65,
    minLng: 21.7,
    maxLng: 27.7,
    minZoom: 8,
  },
  // Wallonia
  wallonia: {
    minZoom: 8,
  },
  // Slovenia
  slovenia: {
    minLat: 45.47,
    maxLat: 46.88,
    minLng: 13.5,
    maxLng: 16.62,
    minZoom: 8,
  },
  // The German Länder with open orthophotos over WMS, each the extent of its boxes. A WMS
  // renders a tile on demand from imagery of 20 to 40 cm, so each starts at the zoom where a
  // tile is a district, not a Land.
  berlin: { minLat: 52.39, maxLat: 52.65, minLng: 13.13, maxLng: 13.74, minZoom: 10 },
  bremen: { minLat: 53.02, maxLat: 53.21, minLng: 8.52, maxLng: 8.97, minZoom: 10 },
  'baden-wuerttemberg': { minLat: 47.56, maxLat: 49.77, minLng: 7.56, maxLng: 10.42, minZoom: 10 },
  bavaria: { minLat: 47.3, maxLat: 50.54, minLng: 9.07, maxLng: 13.79, minZoom: 10 },
  brandenburg: { minLat: 51.38, maxLat: 53.46, minLng: 11.3, maxLng: 14.73, minZoom: 10 },
  hesse: { minLat: 49.53, maxLat: 51.63, minLng: 7.87, maxLng: 10.13, minZoom: 10 },
  'lower-saxony': { minLat: 51.33, maxLat: 53.88, minLng: 6.72, maxLng: 11.5, minZoom: 10 },
  'north-rhine-westphalia': {
    minLat: 50.38,
    maxLat: 52.5,
    minLng: 5.91,
    maxLng: 9.38,
    minZoom: 10,
  },
  'rhineland-palatinate': { minLat: 49, maxLat: 50.88, minLng: 6.16, maxLng: 8.45, minZoom: 10 },
  'saxony-anhalt': { minLat: 50.98, maxLat: 52.99, minLng: 10.59, maxLng: 13.14, minZoom: 10 },
  saxony: { minLat: 50.19, maxLat: 51.64, minLng: 11.94, maxLng: 14.99, minZoom: 10 },
  'schleswig-holstein': { minLat: 53.39, maxLat: 54.9, minLng: 8.43, maxLng: 11.28, minZoom: 10 },
  thuringia: { minLat: 50.22, maxLat: 51.62, minLng: 9.95, maxLng: 12.63, minZoom: 10 },
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
  // What stays inside is Andorra, the Val d'Aran and the crest itself, which no
  // rectangle can cut away from the French valleys beside them.
  ign: {
    tiles: [
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ],
    tileSize: SATELLITE_TILE_SIZE,
    maxzoom: 20,
    attribution: MAP_SOURCE_CREDITS.ign.shortCredit,
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
      [-5.142, 47.85, 3.2, 51.089], // Alsace north of Switzerland, and the rest, to Lille
      [3.2, 47.85, 8.25, 50.4], // Hainaut, the Ardennes and Lorraine, below Belgium
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
    bounds: [9.53, 46.37, 17.17, 49.02],
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
    bounds: [5.73, 49.44, 6.53, 50.18],
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
      [14.0, 45.5, 14.7, 46.48], // Ljubljana and the Karawanks, south of Klagenfurt
      [14.7, 45.45, 15.1, 46.6], // Kočevje and the Savinja Alps
      [15.1, 45.5, 15.72, 46.66], // Celje, Maribor and the Sutla
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
export interface CombinedSatelliteMapStyle {
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
  { id: 'berlin', minZoom: REGIONS['berlin'].minZoom },
  { id: 'bremen', minZoom: REGIONS['bremen'].minZoom },
  { id: 'baden-wuerttemberg', minZoom: REGIONS['baden-wuerttemberg'].minZoom },
  { id: 'bavaria', minZoom: REGIONS['bavaria'].minZoom },
  { id: 'brandenburg', minZoom: REGIONS['brandenburg'].minZoom },
  { id: 'hesse', minZoom: REGIONS['hesse'].minZoom },
  { id: 'lower-saxony', minZoom: REGIONS['lower-saxony'].minZoom },
  { id: 'north-rhine-westphalia', minZoom: REGIONS['north-rhine-westphalia'].minZoom },
  { id: 'rhineland-palatinate', minZoom: REGIONS['rhineland-palatinate'].minZoom },
  { id: 'saxony-anhalt', minZoom: REGIONS['saxony-anhalt'].minZoom },
  { id: 'saxony', minZoom: REGIONS['saxony'].minZoom },
  { id: 'schleswig-holstein', minZoom: REGIONS['schleswig-holstein'].minZoom },
  { id: 'thuringia', minZoom: REGIONS['thuringia'].minZoom },
  { id: 'luxembourg', minZoom: REGIONS.luxembourg.minZoom },
  { id: 'slovenia', minZoom: REGIONS.slovenia.minZoom },
  { id: 'austria', minZoom: REGIONS.austria.minZoom },
  { id: 'netherlands', minZoom: REGIONS.netherlands.minZoom },
  { id: 'wallonia', minZoom: REGIONS.wallonia.minZoom },
  { id: 'czechia', minZoom: REGIONS.czechia.minZoom },
  { id: 'naip', minZoom: REGIONS.usa.minZoom },
  { id: 'ign', minZoom: REGIONS.france.minZoom },
  { id: 'poland', minZoom: REGIONS.poland.minZoom },
  { id: 'spain', minZoom: REGIONS.spain.minZoom },
  { id: 'estonia', minZoom: REGIONS.estonia.minZoom },
];

/**
 * The source that draws the whole range. Rust answers each of its tiles from
 * the topmost regional provider that holds it, and from the global imagery
 * where none does. Its `maxzoom` is the global imagery's, which MapLibre
 * stretches past that.
 */
export const SATELLITE_GLOBAL_SOURCE = 'satellite-global';

/**
 * The source that draws deeper than the global imagery goes. Rust answers each
 * of its tiles from the regional providers alone, and a tile no region holds is
 * a 404 the layer beneath covers.
 */
export const SATELLITE_REGIONS_SOURCE = 'satellite-regions';

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
