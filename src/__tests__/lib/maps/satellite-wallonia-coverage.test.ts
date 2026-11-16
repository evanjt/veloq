/**
 * Scenario: the satellite style over Wallonia and the borders it shares with
 * Luxembourg, the Netherlands, France and the Brussels region.
 * Expected behaviour: a tile over a Walloon town resolves to the Wallonia
 * provider, and a tile over ground another provider holds, or that nobody
 * holds, never resolves to it. The Wallonia source is a WMS asked by the tile's
 * web-mercator bounding box, because its own tile grid is not web mercator.
 */

import {
  SATELLITE_SOURCES,
  getCombinedSatelliteAttribution,
  satelliteProviders,
} from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };

const ZOOM = 16;

/** The ground of the web-mercator tile holding a point, as [west, south, east, north]. */
function tileBounds(p: Point, z: number): [number, number, number, number] {
  const n = 2 ** z;
  const x = Math.floor(((p.lng + 180) / 360) * n);
  const latRad = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const lng = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

/** The provider the composite draws a tile over a point from, topmost first. */
function resolve(p: Point): string | undefined {
  const [west, south, east, north] = tileBounds(p, ZOOM);
  return satelliteProviders('satellite-regions').find(
    (provider) =>
      provider.minZoom <= ZOOM &&
      provider.maxZoom >= ZOOM &&
      provider.boxes.some(([w, s, e, n]) => west <= e && east >= w && south <= n && north >= s)
  )?.source;
}

const WALLONIA: Point[] = [
  { name: 'Namur', lat: 50.467, lng: 4.867 },
  { name: 'Liège', lat: 50.633, lng: 5.567 },
  { name: 'Charleroi', lat: 50.411, lng: 4.444 },
  { name: 'Bastogne', lat: 50.0, lng: 5.718 },
  { name: 'Mons', lat: 50.454, lng: 3.952 },
  { name: 'Tournai', lat: 50.606, lng: 3.389 },
  { name: 'Dinant', lat: 50.261, lng: 4.912 },
  { name: 'Eupen', lat: 50.628, lng: 6.037 },
  { name: 'Virton', lat: 49.567, lng: 5.532 },
  { name: 'Wavre', lat: 50.717, lng: 4.61 },
];

describe('Wallonia satellite provider', () => {
  it.each(WALLONIA)('draws $name from Wallonia', (p) => {
    expect(resolve(p)).toBe('satellite-wallonia');
  });

  it.each([
    ['Luxembourg city', { name: 'Luxembourg', lat: 49.611, lng: 6.13 }, 'satellite-luxembourg'],
    ['Maastricht', { name: 'Maastricht', lat: 50.851, lng: 5.69 }, 'satellite-netherlands'],
    ['Lille', { name: 'Lille', lat: 50.629, lng: 3.057 }, 'satellite-ign'],
    ['Brussels', { name: 'Brussels', lat: 50.847, lng: 4.352 }, undefined],
  ])('leaves %s to its own provider', (_label, point, expected) => {
    expect(resolve(point as Point)).toBe(expected);
  });

  it('asks the WMS by bounding box', () => {
    const [template] = SATELLITE_SOURCES.wallonia.tiles;
    expect(template).toContain('geoservices.wallonie.be');
    expect(template).toContain('{bbox-epsg-3857}');
    expect(template).toContain('CRS=EPSG:3857');
  });

  it('credits the SPW where it draws, and nowhere else', () => {
    expect(SATELLITE_SOURCES.wallonia.attribution).toMatch(/SPW/);
    expect(getCombinedSatelliteAttribution(50.467, 4.867, 12)).toContain('SPW');
    expect(getCombinedSatelliteAttribution(48.857, 2.352, 12)).not.toContain('SPW');
  });
});
