/**
 * Scenario: the satellite style over Estonia, where the regional orthophoto service answers a blank
 * image for every tile outside Estonia rather than a 404.
 * Expected behaviour: MapLibre asks the Estonian source for tiles over Estonia at deep zoom and
 * never for tiles over Latvia, Russia or Finland, because a blank 200 there would paint over the
 * global imagery beneath it.
 */

import { satelliteProviders } from '@/features/maps/components/mapStyles';

type Box = [number, number, number, number];
type Point = { name: string; lat: number; lng: number };

/** The north-west corner of a web-mercator tile, in degrees. */
function tileCorner(z: number, x: number, y: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (rad * 180) / Math.PI, lng };
}

function covered(boxes: Box[], p: { lat: number; lng: number }): boolean {
  return boxes.some(
    ([west, south, east, north]) =>
      p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north
  );
}

/** The boxes the engine is handed for the Estonian provider. */
function estonianBoxes(): Box[] {
  return (
    satelliteProviders('satellite-regions').find((p) => p.source === 'satellite-estonia')?.boxes ??
    []
  );
}

/** The regional provider a tile at this zoom resolves to, in the order the engine asks them. */
function providerFor(z: number, lat: number, lng: number): string | undefined {
  return satelliteProviders('satellite-regions').find(
    (p) => p.minZoom <= z && z <= p.maxZoom && covered(p.boxes ?? [], { lat, lng })
  )?.source;
}

function tileAt(z: number, lat: number, lng: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return tileCorner(z, x, y);
}

const ESTONIA: Point[] = [
  { name: 'Tartu', lat: 58.378, lng: 26.729 },
  { name: 'Tallinn', lat: 59.437, lng: 24.745 },
  { name: 'Pärnu', lat: 58.385, lng: 24.497 },
  { name: 'Haapsalu', lat: 58.943, lng: 23.541 },
  { name: 'Kuressaare', lat: 58.253, lng: 22.486 },
  { name: 'Kärdla', lat: 58.999, lng: 22.75 },
  { name: 'Jõhvi', lat: 59.357, lng: 27.42 },
  { name: 'Otepää', lat: 58.07, lng: 26.49 },
];

const NOT_ESTONIA: Point[] = [
  { name: 'Riga', lat: 56.949, lng: 24.105 },
  { name: 'Valka', lat: 57.775, lng: 26.02 },
  { name: 'Ainaži', lat: 57.87, lng: 24.36 },
  { name: 'Rūjiena', lat: 57.9, lng: 25.33 },
  { name: 'Pskov', lat: 57.819, lng: 28.331 },
  { name: 'Pechory', lat: 57.81, lng: 27.61 },
  { name: 'St Petersburg', lat: 59.93, lng: 30.36 },
  { name: 'Helsinki', lat: 60.169, lng: 24.938 },
  { name: 'Hanko', lat: 59.82, lng: 22.96 },
];

describe('the Estonian source is asked only for tiles over Estonia', () => {
  it.each(ESTONIA)('draws $name at zoom 16 from the Estonian source', ({ lat, lng }) => {
    const corner = tileAt(16, lat, lng);
    expect(providerFor(16, corner.lat, corner.lng)).toBe('satellite-estonia');
  });

  it.each(NOT_ESTONIA)('leaves out $name', ({ lat, lng }) => {
    expect(covered(estonianBoxes(), { lat, lng })).toBe(false);
  });

  it('keeps no two boxes overlapping, so each tile is requested from one box', () => {
    const boxes = estonianBoxes();
    expect(boxes.length).toBeGreaterThan(1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [aw, as, ae, an] = boxes[i];
        const [bw, bs, be, bn] = boxes[j];
        const overlaps = aw < be && bw < ae && as < bn && bs < an;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('is listed among the regional providers the engine is handed', () => {
    const names = satelliteProviders('satellite-regions').map((p) => p.source);
    expect(names).toContain('satellite-estonia');
  });
});
