/**
 * Scenario: the satellite style over Germany, where each Land publishes its own open orthophotos and
 * the national border is shared with countries that have imagery of their own.
 *
 * Expected behaviour: the state capital of each Land draws from that Land's provider and from no
 * other, the ground over the border draws from the neighbour that holds it, and the boxes of one
 * Land never overlap, so a tile is asked of one box alone. A WMS answers a blank tile outside its
 * Land, which is not a refusal the next provider could cover.
 */

import {
  SATELLITE_SOURCES,
  SATELLITE_TILE_SIZE,
  getCombinedSatelliteAttribution,
  satelliteProviders,
} from '@/features/maps/components/mapStyles';
import { MAP_SOURCE_CREDITS } from '@/features/maps/lib/mapSourceCredits';

type Box = [number, number, number, number];
type Point = { name: string; lat: number; lng: number };

const TILE_ZOOM = 16;

const LAENDER = [
  'berlin',
  'bremen',
  'baden-wuerttemberg',
  'bavaria',
  'brandenburg',
  'hesse',
  'lower-saxony',
  'north-rhine-westphalia',
  'rhineland-palatinate',
  'saxony-anhalt',
  'saxony',
  'schleswig-holstein',
  'thuringia',
] as const;

function providers() {
  return satelliteProviders('satellite-regions');
}

function boxesOf(source: string): Box[] {
  return providers().find((p) => p.source === source)?.boxes ?? [];
}

function covered(boxes: Box[], p: Point): boolean {
  return boxes.some(
    ([west, south, east, north]) =>
      p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north
  );
}

/** The provider a tile over this point is asked of first, as the engine chooses it. */
function resolve(p: Point): string | undefined {
  return providers().find(
    (provider) =>
      provider.minZoom <= TILE_ZOOM && TILE_ZOOM <= provider.maxZoom && covered(provider.boxes, p)
  )?.source;
}

const CAPITALS: (Point & { land: (typeof LAENDER)[number] })[] = [
  { land: 'north-rhine-westphalia', name: 'Düsseldorf', lat: 51.2277, lng: 6.7735 },
  { land: 'saxony', name: 'Dresden', lat: 51.05, lng: 13.738 },
  { land: 'bavaria', name: 'Munich', lat: 48.137, lng: 11.575 },
  { land: 'brandenburg', name: 'Potsdam', lat: 52.4, lng: 13.06 },
  { land: 'berlin', name: 'Berlin', lat: 52.52, lng: 13.405 },
  { land: 'thuringia', name: 'Erfurt', lat: 50.978, lng: 11.029 },
  { land: 'lower-saxony', name: 'Hanover', lat: 52.375, lng: 9.732 },
  { land: 'schleswig-holstein', name: 'Kiel', lat: 54.3233, lng: 10.1228 },
  { land: 'hesse', name: 'Wiesbaden', lat: 50.0826, lng: 8.24 },
  { land: 'rhineland-palatinate', name: 'Mainz', lat: 49.993, lng: 8.247 },
  { land: 'saxony-anhalt', name: 'Magdeburg', lat: 52.131, lng: 11.628 },
  { land: 'baden-wuerttemberg', name: 'Stuttgart', lat: 48.776, lng: 9.182 },
  { land: 'bremen', name: 'Bremen', lat: 53.076, lng: 8.807 },
];

/** Ground inside a Land, away from its capital, one side of a Land border. */
const INSIDE: (Point & { land: (typeof LAENDER)[number] })[] = [
  { land: 'north-rhine-westphalia', name: 'Cologne', lat: 50.938, lng: 6.957 },
  { land: 'north-rhine-westphalia', name: 'Aachen', lat: 50.776, lng: 6.084 },
  { land: 'bavaria', name: 'Nuremberg', lat: 49.452, lng: 11.077 },
  { land: 'bavaria', name: 'Neu-Ulm', lat: 48.39, lng: 10.04 },
  { land: 'baden-wuerttemberg', name: 'Ulm', lat: 48.4, lng: 9.97 },
  { land: 'baden-wuerttemberg', name: 'Heidelberg', lat: 49.399, lng: 8.672 },
  { land: 'hesse', name: 'Frankfurt', lat: 50.111, lng: 8.682 },
  { land: 'rhineland-palatinate', name: 'Trier', lat: 49.75, lng: 6.64 },
  { land: 'saxony', name: 'Leipzig', lat: 51.34, lng: 12.375 },
  { land: 'saxony', name: 'Zittau', lat: 50.896, lng: 14.807 },
  { land: 'brandenburg', name: 'Cottbus', lat: 51.757, lng: 14.334 },
  { land: 'brandenburg', name: 'Frankfurt (Oder)', lat: 52.345, lng: 14.53 },
  { land: 'schleswig-holstein', name: 'Flensburg', lat: 54.78, lng: 9.437 },
  { land: 'schleswig-holstein', name: 'Lübeck', lat: 53.866, lng: 10.686 },
  { land: 'lower-saxony', name: 'Braunschweig', lat: 52.268, lng: 10.521 },
  { land: 'lower-saxony', name: 'Cuxhaven', lat: 53.86, lng: 8.7 },
  { land: 'saxony-anhalt', name: 'Halle', lat: 51.482, lng: 11.97 },
  { land: 'thuringia', name: 'Jena', lat: 50.927, lng: 11.589 },
];

/** Ground held today by a neighbour with imagery of its own, or by none. */
const ACROSS_THE_BORDER: (Point & { provider: string | undefined })[] = [
  { provider: 'satellite-swisstopo', name: 'Basel', lat: 47.559, lng: 7.588 },
  { provider: 'satellite-ign', name: 'Strasbourg', lat: 48.573, lng: 7.752 },
  { provider: 'satellite-austria', name: 'Salzburg', lat: 47.8, lng: 13.045 },
  { provider: 'satellite-luxembourg', name: 'Luxembourg', lat: 49.611, lng: 6.13 },
  { provider: 'satellite-netherlands', name: 'Maastricht', lat: 50.851, lng: 5.69 },
  { provider: 'satellite-czechia', name: 'Liberec', lat: 50.77, lng: 15.058 },
  { provider: 'satellite-poland', name: 'Szczecin', lat: 53.428, lng: 14.553 },
  { provider: 'satellite-poland', name: 'Słubice', lat: 52.348, lng: 14.565 },
  { provider: undefined, name: 'Sønderborg', lat: 54.909, lng: 9.79 },
];

describe('each Land draws from its own provider', () => {
  it.each(CAPITALS)('resolves $name to $land and to no other Land', ({ land, lat, lng, name }) => {
    expect(resolve({ name, lat, lng })).toBe(`satellite-${land}`);
  });

  it.each(INSIDE)('resolves $name to $land', ({ land, lat, lng, name }) => {
    expect(resolve({ name, lat, lng })).toBe(`satellite-${land}`);
  });

  it('draws Berlin from Berlin, an enclave Brandenburg surrounds', () => {
    expect(resolve({ name: 'Berlin', lat: 52.52, lng: 13.405 })).toBe('satellite-berlin');
    expect(resolve({ name: 'Spandau', lat: 52.535, lng: 13.2 })).toBe('satellite-berlin');
  });

  it('draws Bremen from Bremen, an enclave Lower Saxony surrounds', () => {
    expect(resolve({ name: 'Bremen', lat: 53.076, lng: 8.807 })).toBe('satellite-bremen');
    expect(resolve({ name: 'Bremen-Nord', lat: 53.18, lng: 8.62 })).toBe('satellite-bremen');
  });

  it('leaves Bremerhaven to the global imagery, which neither Bremen nor Lower Saxony serves', () => {
    expect(resolve({ name: 'Bremerhaven', lat: 53.55, lng: 8.58 })).toBeUndefined();
  });

  it('leaves Hamburg and Saarland out, which publish no open orthophotos over a service', () => {
    expect(resolve({ name: 'Hamburg', lat: 53.55, lng: 10.0 })).toBeUndefined();
    expect(resolve({ name: 'Saarbrücken', lat: 49.234, lng: 6.997 })).toBe('satellite-ign');
  });
});

describe('Mecklenburg-Vorpommern has no regional source', () => {
  it('leaves its ground to the global imagery, since its service is licensed for internal use only', () => {
    expect(resolve({ name: 'Schwerin', lat: 53.629, lng: 11.401 })).toBeUndefined();
    expect(resolve({ name: 'Rostock', lat: 54.092, lng: 12.099 })).toBeUndefined();
    expect(resolve({ name: 'Greifswald', lat: 54.093, lng: 13.38 })).toBeUndefined();
  });

  it('names no provider tile template on its host', () => {
    for (const provider of providers()) {
      expect(provider.template).not.toContain('geodaten-mv.de');
    }
  });
});

describe('the national border stays with the neighbour that holds the ground', () => {
  it.each(ACROSS_THE_BORDER)('resolves $name to $provider', ({ provider, lat, lng, name }) => {
    expect(resolve({ name, lat, lng })).toBe(provider);
  });
});

describe('the stack order', () => {
  const order = () => providers().map((p) => p.source);

  it('puts Berlin above Brandenburg and Bremen above Lower Saxony', () => {
    expect(order().indexOf('satellite-berlin')).toBeLessThan(
      order().indexOf('satellite-brandenburg')
    );
    expect(order().indexOf('satellite-bremen')).toBeLessThan(
      order().indexOf('satellite-lower-saxony')
    );
  });

  it('keeps swisstopo above every Land and every Land above the rectangles that reach into Germany', () => {
    const names = order();
    const lands = LAENDER.map((id) => names.indexOf(`satellite-${id}`));
    expect(Math.min(...lands)).toBeGreaterThan(names.indexOf('satellite-swisstopo'));
    for (const neighbour of ['ign', 'austria', 'netherlands', 'czechia', 'poland', 'luxembourg']) {
      expect(Math.max(...lands)).toBeLessThan(names.indexOf(`satellite-${neighbour}`));
    }
  });
});

describe('the boxes of one Land', () => {
  it.each(LAENDER)('%s has no two boxes that overlap', (id) => {
    const boxes = boxesOf(`satellite-${id}`);
    expect(boxes.length).toBeGreaterThan(0);
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

  it('no point lies in the boxes of two Länder', () => {
    const all = LAENDER.flatMap((id) => boxesOf(`satellite-${id}`).map((box) => ({ id, box })));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].id === all[j].id) continue;
        const [aw, as, ae, an] = all[i].box;
        const [bw, bs, be, bn] = all[j].box;
        const overlapLng = Math.min(ae, be) - Math.max(aw, bw);
        const overlapLat = Math.min(an, bn) - Math.max(as, bs);
        expect({
          pair: [all[i].id, all[j].id],
          overlaps: overlapLng > 0 && overlapLat > 0,
        }).toEqual({ pair: [all[i].id, all[j].id], overlaps: false });
      }
    }
  });
});

describe('each Land has one source, one template and one credit', () => {
  it.each(LAENDER)('%s asks for its tiles by bbox over WMS and credits its licensor', (id) => {
    const source = SATELLITE_SOURCES[id];
    expect(source.tiles).toHaveLength(1);
    expect(source.tiles[0]).toMatch(/^https:\/\/[^/]+\/.*SERVICE=WMS.*CRS=EPSG:3857.*/);
    expect(source.tiles[0]).toContain('BBOX={bbox-epsg-3857}');
    expect(source.tiles[0]).toContain('FORMAT=image/jpeg');
    expect(source.tileSize).toBe(SATELLITE_TILE_SIZE);
    expect(source.maxzoom).toBe(20);
    expect(source.attribution).toBe(MAP_SOURCE_CREDITS[id].shortCredit);
    expect(MAP_SOURCE_CREDITS[id].url).toMatch(/^https:\/\//);
    expect(MAP_SOURCE_CREDITS[id].shortCredit.length).toBeGreaterThan(0);
  });

  it('credits the Land that draws a point, and only that Land', () => {
    expect(getCombinedSatelliteAttribution(48.137, 11.575, 14)).toBe(
      MAP_SOURCE_CREDITS.bavaria.shortCredit
    );
    expect(getCombinedSatelliteAttribution(52.52, 13.405, 14)).toBe(
      MAP_SOURCE_CREDITS.berlin.shortCredit
    );
  });
});
