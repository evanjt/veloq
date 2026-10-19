/**
 * Scenario: the map draws a source whose licence asks for a credit, and the
 * map line carries only a short form of it.
 * Expected behaviour: the licences screen lists that source with its full
 * licence text and the licensor's URL, so the short form stays permitted.
 */
import { SATELLITE_SOURCES, type SatelliteSourceId } from '@/features/maps/components/mapStyles';
import {
  eoxDataYear,
  mapDataLicenceEntries,
  MAP_SOURCE_CREDITS,
  type MapSourceId,
} from '@/features/maps/lib/mapSourceCredits';

const BASE_MAP_SOURCES = ['openstreetmap', 'openmaptiles', 'openfreemap'] as const;

const EVERY_SOURCE: MapSourceId[] = [
  ...(Object.keys(SATELLITE_SOURCES) as SatelliteSourceId[]),
  ...BASE_MAP_SOURCES,
  'terrain',
];

describe('map data licence entries', () => {
  const entries = mapDataLicenceEntries();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  it.each(EVERY_SOURCE)('lists %s with its licence, full text and URL', (id) => {
    const entry = byId.get(id);
    expect(entry).toBeDefined();
    expect(entry?.name.trim()).not.toBe('');
    expect(entry?.license.trim()).not.toBe('');
    expect(entry?.description.trim()).not.toBe('');
    expect(entry?.repository).toMatch(/^https:\/\/\S+$/);
  });

  it('lists each source once', () => {
    expect(byId.size).toBe(entries.length);
  });

  it('gives the EOX credit in the form its licence asks for, with the served layer year', () => {
    const eox = byId.get('eox');
    expect(eox?.description).toContain('Contains modified Copernicus Sentinel data');
    expect(eox?.description).toContain('by EOX IT Services GmbH');
    const year = eoxDataYear(SATELLITE_SOURCES.eox.tiles[0]);
    expect(eox?.description).toContain(`Contains modified Copernicus Sentinel data ${year})`);
  });

  it('credits OpenMapTiles under its schema licence', () => {
    expect(byId.get('openmaptiles')?.license).toBe('CC BY 4.0');
  });

  it('names Mapzen among the terrain credits and the per-source list', () => {
    const terrain = byId.get('terrain')?.description ?? '';
    expect(terrain).toContain('Mapzen');
    expect(terrain).toContain('U.S. Geological Survey');
    expect(terrain).toContain('EU-DEM');
  });

  it('keeps the map line credit each satellite source draws from the same table', () => {
    for (const id of Object.keys(SATELLITE_SOURCES) as SatelliteSourceId[]) {
      expect(SATELLITE_SOURCES[id].attribution).toBe(MAP_SOURCE_CREDITS[id].shortCredit);
    }
  });
});

describe('eoxDataYear', () => {
  it('reads the 2016 edition from the unsuffixed layer', () => {
    expect(
      eoxDataYear('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg')
    ).toBe('2016');
  });

  it('reads the edition year from a suffixed layer', () => {
    expect(
      eoxDataYear(
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
      )
    ).toBe('2020');
  });

  it('refuses a URL that names no cloudless layer', () => {
    expect(() => eoxDataYear('https://example.org/{z}/{x}/{y}.png')).toThrow();
  });
});
