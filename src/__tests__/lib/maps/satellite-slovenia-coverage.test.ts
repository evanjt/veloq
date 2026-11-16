/**
 * Scenario: the satellite style over Slovenia and the ground beside it. The
 * Slovene orthophoto is a WMS that answers a blank 200 outside its data, so a
 * box reaching into Austria, Italy, Croatia or Hungary draws white over
 * ground another provider holds.
 *
 * Expected behaviour: a tile over a Slovene town resolves to the Slovene
 * source, a tile over a neighbouring town does not, and Klagenfurt keeps the
 * Austrian source although Austria's box reaches south over the border.
 */

import {
  SATELLITE_SOURCES,
  satelliteProviders,
  getCombinedSatelliteAttribution,
} from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };

const ZOOM = 16;

/** The ground a web-mercator tile covers, as [west, south, east, north]. */
function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lng = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

/** The source the engine answers the tile over a point from, as the engine picks it. */
function resolves(p: Point): string | undefined {
  const n = 2 ** ZOOM;
  const x = Math.floor(((p.lng + 180) / 360) * n);
  const rad = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  const [tw, ts, te, tn] = tileBounds(ZOOM, x, y);
  return satelliteProviders('satellite-regions').find(
    (p) =>
      ZOOM >= p.minZoom &&
      ZOOM <= p.maxZoom &&
      p.boxes.some(([w, s, e, nn]) => tw < e && te > w && ts < nn && tn > s)
  )?.source;
}

const SLOVENIA: Point[] = [
  { name: 'Ljubljana', lat: 46.051, lng: 14.506 },
  { name: 'Maribor', lat: 46.554, lng: 15.646 },
  { name: 'Kranjska Gora', lat: 46.485, lng: 13.786 },
  { name: 'Koper', lat: 45.548, lng: 13.73 },
  { name: 'Celje', lat: 46.231, lng: 15.267 },
  { name: 'Nova Gorica', lat: 45.956, lng: 13.649 },
  { name: 'Bovec', lat: 46.337, lng: 13.553 },
  { name: 'Murska Sobota', lat: 46.662, lng: 16.164 },
  { name: 'Novo Mesto', lat: 45.804, lng: 15.169 },
  { name: 'Ptuj', lat: 46.42, lng: 15.87 },
];

const NOT_SLOVENIA: Point[] = [
  { name: 'Zagreb', lat: 45.815, lng: 15.982 },
  { name: 'Trieste', lat: 45.649, lng: 13.777 },
  { name: 'Graz', lat: 47.07, lng: 15.439 },
  { name: 'Villach', lat: 46.61, lng: 13.85 },
  { name: 'Karlovac', lat: 45.487, lng: 15.548 },
];

describe('the Slovene source is asked only for tiles over Slovenia', () => {
  it.each(SLOVENIA)('draws $name from the Slovene source', (p) => {
    expect(resolves(p)).toBe('satellite-slovenia');
  });

  it.each(NOT_SLOVENIA)('leaves $name to another source', (p) => {
    expect(resolves(p)).not.toBe('satellite-slovenia');
  });

  it('still draws Klagenfurt from the Austrian source', () => {
    expect(resolves({ name: 'Klagenfurt', lat: 46.624, lng: 14.308 })).toBe('satellite-austria');
  });

  it('asks the WMS for each tile through the bbox placeholder', () => {
    const [template] = SATELLITE_SOURCES.slovenia.tiles;
    expect(template).toContain('{bbox-epsg-3857}');
    expect(template).not.toContain('{z}');
    expect(SATELLITE_SOURCES.slovenia.maxzoom).toBe(20);
  });

  it('credits the Slovene survey over Ljubljana', () => {
    expect(getCombinedSatelliteAttribution(46.051, 14.506, 17)).toContain('GURS');
  });
});
