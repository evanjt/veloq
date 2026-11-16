import { EOX_S2CLOUDLESS_TEMPLATE } from '@/features/maps/lib/eoxTemplate';
import type { SatelliteSourceId } from '@/features/maps/components/mapStyles';

/** Every source the map draws from: the base map's three, each satellite source and terrain. */
export type MapSourceId =
  'openstreetmap' | 'openmaptiles' | 'openfreemap' | SatelliteSourceId | 'terrain';

export interface MapSourceCredit {
  /** The source as the licences screen names it. */
  name: string;
  /** What the map line shows for this source. */
  shortCredit: string;
  /** The licence the source is used under. */
  licence: string;
  /** The licensor's page for the licence or the source. */
  url: string;
  /** The full credit the licensor asks for, which the licences screen shows. */
  fullText: string;
}

/**
 * The Copernicus data year of the cloudless edition a tiles URL serves. The
 * unsuffixed layer is the 2016 edition, and a later edition names its year as
 * `s2cloudless-YYYY`.
 */
export function eoxDataYear(tilesUrl: string): string {
  const match = /\/s2cloudless(?:-(\d{4}))?_\d+\//.exec(tilesUrl);
  if (!match) throw new Error(`No Sentinel-2 cloudless layer in ${tilesUrl}`);
  return match[1] ?? '2016';
}

/**
 * The year the imagery is retrieved, for the credits of the licences that ask
 * for a data year or date: three German Land licences ask for the year of data
 * retrieval ("Jahr des Datenbezugs"), Estonia for the date of extraction and
 * Slovenia for the time the data refer to. Their services serve flights of
 * several years with no single year stated, so the credit names the year the
 * app fetches the tiles.
 */
const DATA_RETRIEVAL_YEAR = new Date().getFullYear();

const TERRAIN_SOURCES = [
  '3DEP, SRTM and GMTED2010 data courtesy of the U.S. Geological Survey',
  'ETOPO1 data from the U.S. National Oceanic and Atmospheric Administration (DOC/NOAA/NESDIS/NCEI)',
  'ArcticDEM terrain data created from DigitalGlobe, Inc. imagery and funded under National Science Foundation awards 1043681, 1559691 and 1542736',
  'Australia: © Commonwealth of Australia (Geoscience Australia) 2017',
  'Austria: © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich',
  'Canada: contains information licensed under the Open Government Licence – Canada',
  'Europe: produced using Copernicus data and information funded by the European Union - EU-DEM layers',
  'Mexico: Source: INEGI, Continental relief, 2016',
  'New Zealand: Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government. All rights reserved',
  'Norway: © Kartverket',
  'United Kingdom: © Environment Agency copyright and/or database right 2015. All rights reserved',
];

/** What the map line puts between two sources' short credits. */
export const CREDIT_SEPARATOR = ' · ';

/** The map line for these sources: each one's short credit, in the order given. */
export function joinShortCredits(ids: readonly MapSourceId[]): string {
  return ids.map((id) => MAP_SOURCE_CREDITS[id].shortCredit).join(CREDIT_SEPARATOR);
}

/**
 * The one table of map credits. The map line reads `shortCredit`, the
 * licences screen lists every entry with its full text, so a source added
 * here reaches both.
 */
export const MAP_SOURCE_CREDITS: Record<MapSourceId, MapSourceCredit> = {
  openstreetmap: {
    name: 'OpenStreetMap',
    shortCredit: '© OpenStreetMap',
    licence: 'ODbL',
    url: 'https://www.openstreetmap.org/copyright',
    fullText: '© OpenStreetMap contributors. Data available under the Open Database Licence.',
  },
  openmaptiles: {
    name: 'OpenMapTiles',
    shortCredit: '© OpenMapTiles',
    licence: 'CC BY 4.0',
    url: 'https://openmaptiles.org',
    fullText: '© OpenMapTiles. The vector tile schema the base map is drawn from.',
  },
  openfreemap: {
    name: 'OpenFreeMap',
    shortCredit: '© OpenFreeMap',
    licence: 'ODbL',
    url: 'https://openfreemap.org',
    fullText: 'Base map tiles hosted by OpenFreeMap, built from OpenStreetMap data.',
  },
  swisstopo: {
    name: 'swisstopo SWISSIMAGE',
    shortCredit: '© swisstopo',
    licence: 'OGD swisstopo',
    url: 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
    fullText: 'Aerial imagery of Switzerland. Source: Federal Office of Topography swisstopo.',
  },
  ign: {
    name: 'IGN BD ORTHO',
    shortCredit: '© IGN',
    licence: 'Licence Ouverte 2.0',
    url: 'https://geoservices.ign.fr/cgu-licences',
    fullText: 'Aerial imagery of France. Source: IGN – BD ORTHO®, via the Géoplateforme.',
  },
  naip: {
    name: 'USGS NAIP',
    shortCredit: 'USGS NAIP',
    licence: 'Public Domain',
    url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    fullText:
      'Aerial imagery of the United States from the USDA Farm Service Agency National Agriculture Imagery Program, served by the U.S. Geological Survey.',
  },
  spain: {
    name: 'PNOA',
    shortCredit: 'CC BY 4.0 scne.es',
    licence: 'CC BY 4.0',
    url: 'https://www.scne.es',
    fullText:
      'Aerial imagery of Spain. PNOA ortofotos, CC BY 4.0 scne.es, Instituto Geográfico Nacional de España.',
  },
  austria: {
    name: 'basemap.at Orthofoto',
    shortCredit: 'basemap.at',
    licence: 'CC BY 4.0',
    url: 'https://basemap.at',
    fullText: 'Aerial imagery of Austria. Datenquelle: basemap.at.',
  },
  netherlands: {
    name: 'PDOK Luchtfoto',
    shortCredit: '© Kadaster / PDOK',
    licence: 'CC BY 4.0',
    url: 'https://www.pdok.nl',
    fullText: 'Aerial imagery of the Netherlands. © Kadaster / PDOK, Luchtfoto Actueel Ortho HR.',
  },
  czechia: {
    name: 'ČÚZK Ortofoto',
    shortCredit: '© ČÚZK',
    licence: 'CC BY 4.0',
    url: 'https://geoportal.cuzk.cz',
    fullText:
      'Aerial imagery of the Czech Republic. © Český úřad zeměměřický a katastrální (ČÚZK), Ortofoto ČR.',
  },
  poland: {
    name: 'GUGiK Ortofotomapa',
    shortCredit: '© GUGiK',
    licence: 'Free reuse, Geodetic and Cartographic Law Art. 40a',
    url: 'https://www.geoportal.gov.pl',
    fullText:
      'Aerial imagery of Poland. © Główny Urząd Geodezji i Kartografii (GUGiK), Ortofotomapa.',
  },
  luxembourg: {
    name: 'ACT BD-L-ORTHO',
    shortCredit: '© ACT Luxembourg',
    licence: 'CC0 1.0',
    url: 'https://data.public.lu',
    fullText:
      'Aerial imagery of Luxembourg. © Administration du cadastre et de la topographie (ACT), BD-L-ORTHO.',
  },
  estonia: {
    name: 'Maa- ja Ruumiamet ortofoto',
    shortCredit: `© Maa- ja Ruumiamet (${DATA_RETRIEVAL_YEAR})`,
    licence: 'Estonian Land Board open data licence',
    url: 'https://geoportaal.maaruum.ee/opendata-licence',
    fullText: `Aerial imagery of Estonia. Orthophoto ${DATA_RETRIEVAL_YEAR}, Republic of Estonia Land and Spatial Development Board.`,
  },
  wallonia: {
    name: 'SPW Orthophotos',
    shortCredit: 'Source : SPW',
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    fullText:
      'Aerial imagery of Wallonia. Source : Service public de Wallonie (SPW) – Orthophotos – Vues aériennes les plus récentes.',
  },
  slovenia: {
    name: 'GURS Digitalni ortofoto',
    shortCredit: '© GURS',
    licence: 'CC BY 4.0',
    url: 'https://www.e-prostor.gov.si/en/access-to-geodetic-data/',
    fullText: `Aerial imagery of Slovenia. © Geodetska uprava Republike Slovenije (GURS), Digitalni ortofoto 25 cm, ${DATA_RETRIEVAL_YEAR}.`,
  },
  berlin: {
    name: 'Berlin TrueDOP',
    shortCredit: '© Geoportal Berlin',
    licence: 'dl-de/zero-2.0',
    url: 'https://www.govdata.de/dl-de/zero-2-0',
    fullText:
      'Aerial imagery of Berlin. © Geoportal Berlin, Digitale farbige TrueOrthophotos 2024, Datenlizenz Deutschland – Zero – Version 2.0.',
  },
  bremen: {
    name: 'Bremen DOP20',
    shortCredit: '© Landesamt GeoInformation Bremen',
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.de',
    fullText:
      'Aerial imagery of Bremen and Bremerhaven. © Landesamt GeoInformation Bremen, DOP20 2023, Creative Commons Namensnennung 4.0 (CC BY 4.0).',
  },
  'baden-wuerttemberg': {
    name: 'LGL-BW DOP20',
    shortCredit: `© LGL-BW (${DATA_RETRIEVAL_YEAR})`,
    licence: 'dl-de/by-2.0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
    fullText:
      'Aerial imagery of Baden-Württemberg. © Landesamt für Geoinformation und Landentwicklung Baden-Württemberg (LGL-BW), Digitale Orthophotos 20 cm, Datenlizenz Deutschland – Namensnennung – Version 2.0, www.lgl-bw.de.',
  },
  bavaria: {
    name: 'Bayern DOP40',
    shortCredit: '© Bayerische Vermessungsverwaltung – www.geodaten.bayern.de',
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.de',
    fullText:
      'Aerial imagery of Bavaria. © Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, Digitales Orthophoto 40 cm, CC BY 4.0.',
  },
  brandenburg: {
    name: 'LGB DOP20',
    shortCredit: '© GeoBasis-DE/LGB',
    licence: 'dl-de/by-2.0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
    fullText: 'Aerial imagery of Brandenburg. © GeoBasis-DE/LGB, dl-de/by-2-0.',
  },
  hesse: {
    name: 'HVBG DOP20',
    shortCredit: '© HVBG',
    licence: 'HVGG \u00a7\u00a7 18, 24',
    url: 'https://hvbg.hessen.de',
    fullText:
      'Aerial imagery of Hesse. © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG), Digitale Orthophotos 20 cm, free for any use under §§ 18 and 24 of the Hessian Surveying and Geoinformation Act.',
  },
  'lower-saxony': {
    name: 'LGLN DOP20',
    shortCredit: `© LGLN (${DATA_RETRIEVAL_YEAR})`,
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    fullText:
      'Aerial imagery of Lower Saxony. © Landesamt für Geoinformation und Landesvermessung Niedersachsen (LGLN), Digitale Orthophotos 20 cm, Creative Commons Namensnennung – 4.0 International (CC BY 4.0).',
  },
  'north-rhine-westphalia': {
    name: 'Geobasis NRW DOP',
    shortCredit: '© Geobasis NRW',
    licence: 'dl-de/zero-2.0',
    url: 'https://www.govdata.de/dl-de/zero-2-0',
    fullText:
      'Aerial imagery of North Rhine-Westphalia. © Geobasis NRW, Digitale Orthophotos, Datenlizenz Deutschland – Zero – Version 2.0.',
  },
  'rhineland-palatinate': {
    name: 'LVermGeoRP DOP20',
    shortCredit: `© GeoBasis-DE / LVermGeoRP (${DATA_RETRIEVAL_YEAR})`,
    licence: 'dl-de/by-2.0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
    fullText:
      'Aerial imagery of Rhineland-Palatinate. © GeoBasis-DE / LVermGeoRP, Digitale Orthophotos 20 cm, dl-de/by-2-0, http://www.lvermgeo.rlp.de.',
  },
  'saxony-anhalt': {
    name: 'LVermGeo ST DOP20',
    shortCredit: '© GeoBasis-DE / LVermGeo ST',
    licence: 'dl-de/by-2.0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
    fullText:
      'Aerial imagery of Saxony-Anhalt. © GeoBasis-DE / LVermGeo ST, Digitale Orthophotos 20 cm, Datenlizenz Deutschland – Namensnennung – Version 2.0.',
  },
  saxony: {
    name: 'GeoSN DOP20',
    shortCredit: '© GeoSN',
    licence: 'dl-de/by-2.0',
    url: 'https://www.govdata.de/dl-de/by-2-0',
    fullText:
      'Aerial imagery of Saxony. © Landesamt für Geobasisinformation Sachsen (GeoSN), Digitale Orthophotos 20 cm, Datenlizenz Deutschland – Namensnennung – Version 2.0.',
  },
  'schleswig-holstein': {
    name: 'LVermGeo SH DOP20',
    shortCredit: '© GeoBasis-DE/LVermGeo SH/CC BY 4.0',
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0',
    fullText:
      'Aerial imagery of Schleswig-Holstein. © GeoBasis-DE/LVermGeo SH/CC BY 4.0, Digitale Orthophotos 20 cm.',
  },
  thuringia: {
    name: 'GDI-Th DOP20',
    shortCredit: '© GDI-Th',
    licence: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.de',
    fullText:
      'Aerial imagery of Thuringia. © GDI-Th, Digitale Orthophotos 20 cm, Creative Commons Namensnennung 4.0 (CC BY 4.0).',
  },
  eox: {
    name: 'EOX Sentinel-2 cloudless',
    shortCredit: 'Sentinel-2 cloudless by EOX',
    licence: 'CC BY 4.0',
    url: 'https://s2maps.eu',
    fullText: `Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${eoxDataYear(EOX_S2CLOUDLESS_TEMPLATE)})`,
  },
  terrain: {
    name: 'Mapzen Terrain Tiles',
    shortCredit: 'Mapzen',
    licence: 'Open data, per source',
    url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    fullText: `3D elevation from the Mapzen terrain tiles. ${TERRAIN_SOURCES.join('. ')}.`,
  },
};

/** What the line under a vector basemap credits: the same on the light and the dark base. */
export const BASE_MAP_ATTRIBUTION = joinShortCredits([
  'openfreemap',
  'openmaptiles',
  'openstreetmap',
]);

export interface MapDataLicenceEntry {
  id: MapSourceId;
  name: string;
  license: string;
  repository: string;
  description: string;
}

/** The licences screen's map data section, one entry per source in the table's order. */
export function mapDataLicenceEntries(): MapDataLicenceEntry[] {
  return (Object.keys(MAP_SOURCE_CREDITS) as MapSourceId[]).map((id) => {
    const credit = MAP_SOURCE_CREDITS[id];
    return {
      id,
      name: credit.name,
      license: credit.licence,
      repository: credit.url,
      description: credit.fullText,
    };
  });
}
