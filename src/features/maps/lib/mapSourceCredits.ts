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
