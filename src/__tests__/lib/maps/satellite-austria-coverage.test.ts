/**
 * Scenario: the satellite style over Austria and the ground beside it. The Austrian orthophoto
 * answers a blank 200 outside its data, so a box reaching into Italy, Czechia, Slovakia or
 * Hungary paints a flat tile over ground another provider holds.
 *
 * Expected behaviour: a tile over an Austrian town resolves to the Austrian source, and a tile
 * over a town across the Italian, Czech, Slovak or Hungarian border does not.
 */

import { satelliteProviders } from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };

const ZOOM = 15;

/** The ground a web-mercator tile covers, as [west, south, east, north]. */
function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lng = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

/** The source the engine answers the tile over a point from, as the engine picks it. */
function resolves(p: Point, z: number = ZOOM): string | undefined {
  const n = 2 ** z;
  const x = Math.floor(((p.lng + 180) / 360) * n);
  const rad = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  const [tw, ts, te, tn] = tileBounds(z, x, y);
  return satelliteProviders('satellite-regions').find(
    (provider) =>
      z >= provider.minZoom &&
      z <= provider.maxZoom &&
      provider.boxes.some(([w, s, e, nn]) => tw < e && te > w && ts < nn && tn > s)
  )?.source;
}

const AUSTRIA: Point[] = [
  { name: 'Innsbruck', lat: 47.269, lng: 11.404 },
  { name: 'Lienz', lat: 46.829, lng: 12.768 },
  { name: 'Freistadt', lat: 48.509, lng: 14.5 },
  { name: 'Gmünd', lat: 48.753, lng: 15.001 },
  { name: 'Retz', lat: 48.767, lng: 15.95 },
  { name: 'Hainburg', lat: 48.145, lng: 16.94 },
  { name: 'Eisenstadt', lat: 47.845, lng: 16.52 },
  { name: 'Klagenfurt', lat: 46.625, lng: 14.305 },
];

const NOT_AUSTRIA: Point[] = [
  { name: 'Bormio', lat: 46.467, lng: 10.37 },
  { name: 'Bolzano', lat: 46.5, lng: 11.35 },
  { name: 'Merano', lat: 46.67, lng: 11.16 },
  { name: 'Budweis', lat: 48.975, lng: 14.475 },
  { name: 'Znojmo', lat: 48.855, lng: 16.05 },
  { name: 'Bratislava', lat: 48.145, lng: 17.1 },
  { name: 'Sopron', lat: 47.685, lng: 16.59 },
];

describe('the Austrian source is asked only for tiles over Austria', () => {
  it.each(AUSTRIA)('draws $name from the Austrian source', (p) => {
    expect(resolves(p)).toBe('satellite-austria');
  });

  it.each(NOT_AUSTRIA)('leaves $name to another source at zoom 15', (p) => {
    expect(resolves(p)).not.toBe('satellite-austria');
  });

  it.each(NOT_AUSTRIA)('leaves $name to another source at zoom 16', (p) => {
    expect(resolves(p, 16)).not.toBe('satellite-austria');
  });
});
