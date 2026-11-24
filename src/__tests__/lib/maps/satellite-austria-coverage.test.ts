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

/**
 * Centres of zoom 15 tiles on the boxes' edges. basemap.at answers each with its flat blank
 * tile, a 200 with no imagery, so Austria must not be the source for any of them.
 */
const BLANK_GROUND: [number, number][] = [
  [46.5475, 12.8265],
  [46.5475, 12.9474],
  [46.5475, 13.0682],
  [46.5475, 13.1891],
  [46.5475, 13.3539],
  [46.6079, 15.0458],
  [46.6532, 12.3651],
  [46.6532, 12.486],
  [46.6683, 15.7489],
  [46.6683, 15.9467],
  [46.7286, 16.0455],
  [46.7512, 10.7501],
  [46.7512, 10.9039],
  [46.7512, 11.0248],
  [46.7512, 12.1454],
  [46.7512, 12.2662],
  [46.8489, 10.6293],
  [46.8489, 11.1017],
  [46.8715, 12.1454],
  [46.9465, 11.1896],
  [46.9465, 11.3104],
  [46.9465, 11.4313],
  [46.9465, 11.5521],
  [46.9465, 11.673],
  [46.9465, 11.7938],
  [46.9465, 16.2762],
  [46.9465, 16.3971],
  [46.9465, 16.5179],
  [47.0364, 16.5509],
  [47.0439, 12.1454],
  [47.2531, 16.507],
  [47.3351, 16.5509],
  [47.35, 10.3436],
  [47.5506, 9.5636],
  [47.5506, 10.5194],
  [47.6173, 13.0463],
  [47.6469, 9.7833],
  [47.6469, 12.5079],
  [47.6469, 12.7936],
  [47.6469, 16.7487],
  [47.6469, 16.8695],
  [47.6469, 16.9904],
  [47.6543, 16.5509],
  [47.8463, 17.0782],
  [47.8906, 17.1552],
  [48.0377, 17.1552],
  [48.1478, 12.7606],
  [48.2137, 12.8485],
  [48.2503, 12.9803],
  [48.2868, 16.9464],
  [48.3526, 13.3209],
  [48.411, 16.9464],
  [48.5493, 13.6835],
  [48.6075, 14.2108],
  [48.6075, 14.3756],
  [48.6511, 14.079],
  [48.6511, 14.4965],
  [48.6511, 14.6173],
  [48.6511, 16.9464],
  [48.7163, 14.7272],
  [48.7308, 14.035],
  [48.7526, 13.9362],
  [48.7526, 16.3092],
  [48.7526, 16.7047],
  [48.7526, 16.8256],
  [48.8249, 16.452],
  [48.8322, 14.9469],
  [48.8394, 15.9686],
  [48.8466, 16.5509],
  [48.9044, 15.65],
  [48.9478, 15.5182],
  [48.955, 14.9469],
  [48.9838, 15.2545],
  [49.0054, 15.3534],
  [49.0127, 15.1447],
  [49.0487, 14.9799],
];

describe('the Austrian source is asked only for tiles over Austria', () => {
  it.each(AUSTRIA)('draws $name from the Austrian source', (p) => {
    expect(resolves(p)).toBe('satellite-austria');
  });

  it.each(BLANK_GROUND)('leaves blank ground at %f, %f to another source', (lat, lng) => {
    expect(resolves({ name: 'blank tile', lat, lng })).not.toBe('satellite-austria');
  });

  it.each(NOT_AUSTRIA)('leaves $name to another source at zoom 15', (p) => {
    expect(resolves(p)).not.toBe('satellite-austria');
  });

  it.each(NOT_AUSTRIA)('leaves $name to another source at zoom 16', (p) => {
    expect(resolves(p, 16)).not.toBe('satellite-austria');
  });
});
