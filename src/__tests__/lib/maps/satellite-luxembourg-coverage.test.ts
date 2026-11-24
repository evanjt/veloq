/**
 * Scenario: the satellite style over Luxembourg and the towns across its French and Belgian
 * borders, where the Luxembourg service answers a blank white tile.
 * Expected behaviour: a tile over a Luxembourg town resolves to the Luxembourg provider, and a
 * tile over a Belgian or French town never does, so the white tile is not drawn over ground
 * Wallonia or IGN holds. The boxes are a staircase that follows the borders.
 */

import { SATELLITE_SOURCES, satelliteProviders } from '@/features/maps/components/mapStyles';

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

const LUXEMBOURG: Point[] = [
  { name: 'Luxembourg city', lat: 49.611, lng: 6.13 },
  { name: 'Esch-sur-Alzette', lat: 49.496, lng: 5.981 },
  { name: 'Rodange', lat: 49.547, lng: 5.84 },
  { name: 'Wiltz', lat: 49.969, lng: 5.934 },
  { name: 'Clervaux', lat: 50.053, lng: 6.04 },
  { name: 'Echternach', lat: 49.81, lng: 6.42 },
];

const ACROSS_THE_BORDER: Point[] = [
  { name: 'Arlon', lat: 49.683, lng: 5.817 },
  { name: 'Houffalize', lat: 50.132, lng: 5.79 },
  { name: 'Longwy', lat: 49.52, lng: 5.76 },
  { name: 'Villerupt', lat: 49.47, lng: 5.93 },
];

describe('Luxembourg satellite provider', () => {
  it.each(LUXEMBOURG)('draws $name from Luxembourg', (p) => {
    expect(resolve(p)).toBe('satellite-luxembourg');
  });

  it.each(ACROSS_THE_BORDER)('does not draw $name from Luxembourg', (p) => {
    expect(resolve(p)).not.toBe('satellite-luxembourg');
  });

  it('keeps every box inside the bounding rectangle of Luxembourg', () => {
    const [west, south, east, north] = [5.73, 49.44, 6.53, 50.18];
    const boxes = SATELLITE_SOURCES.luxembourg.boxes ?? [];
    expect(boxes.length).toBeGreaterThan(1);
    for (const [w, s, e, n] of boxes) {
      expect(w).toBeGreaterThanOrEqual(west);
      expect(s).toBeGreaterThanOrEqual(south);
      expect(e).toBeLessThanOrEqual(east);
      expect(n).toBeLessThanOrEqual(north);
    }
  });

  it('has no two boxes that overlap', () => {
    const boxes = SATELLITE_SOURCES.luxembourg.boxes ?? [];
    expect(boxes.length).toBeGreaterThan(1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [aw, as, ae, an] = boxes[i];
        const [bw, bs, be, bn] = boxes[j];
        const overlapLng = Math.min(ae, be) - Math.max(aw, bw);
        const overlapLat = Math.min(an, bn) - Math.max(as, bs);
        expect(overlapLng > 0 && overlapLat > 0).toBe(false);
      }
    }
  });
});
