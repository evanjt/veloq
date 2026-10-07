/**
 * Scenario: the satellite style over the Swiss border, where the swisstopo
 * source declared one bbox of the Swiss extent and sits above every other
 * regional raster. Chamonix, Annecy, Aosta and Vorarlberg all fall inside that
 * rectangle.
 *
 * Expected behaviour: MapLibre never asks swisstopo for a tile outside
 * Switzerland, the credit over French, Italian and Austrian ground names
 * whoever draws it, and every Swiss town keeps its imagery. Swisstopo serves
 * Swiss orthophotos only, so a tile over Chamonix is a 404 drawn over IGN's
 * own imagery and credited to the wrong licence.
 */

import {
  SATELLITE_SOURCES,
  getCombinedSatelliteAttribution,
  getCombinedSatelliteStyle,
} from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };
type Box = [number, number, number, number];

/** Every bbox the style hands MapLibre for the swisstopo source. */
function swisstopoBoxes(): Box[] {
  const style = getCombinedSatelliteStyle();
  return Object.entries(style.sources)
    .filter(([id]) => /^satellite-swisstopo(-\d+)?$/.test(id))
    .map(([, source]) => source.bounds)
    .filter((b): b is Box => b !== undefined);
}

function covered(boxes: Box[], p: Point): boolean {
  return boxes.some(
    ([west, south, east, north]) =>
      p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north
  );
}

const SWITZERLAND: Point[] = [
  { name: 'Geneva', lat: 46.204, lng: 6.143 },
  { name: 'Nyon', lat: 46.383, lng: 6.239 },
  { name: 'Rolle', lat: 46.459, lng: 6.338 },
  { name: 'Morges', lat: 46.511, lng: 6.498 },
  { name: 'Lausanne', lat: 46.519, lng: 6.633 },
  { name: 'Vevey', lat: 46.463, lng: 6.843 },
  { name: 'Montreux', lat: 46.437, lng: 6.911 },
  { name: 'Martigny', lat: 46.103, lng: 7.073 },
  { name: 'Sion', lat: 46.233, lng: 7.36 },
  { name: 'Zermatt', lat: 46.021, lng: 7.749 },
  { name: 'Brig', lat: 46.317, lng: 7.988 },
  { name: 'Airolo', lat: 46.528, lng: 8.612 },
  { name: 'Ascona', lat: 46.155, lng: 8.774 },
  { name: 'Locarno', lat: 46.171, lng: 8.795 },
  { name: 'Lugano', lat: 46.005, lng: 8.951 },
  { name: 'Chiasso', lat: 45.832, lng: 9.025 },
  { name: 'Bellinzona', lat: 46.195, lng: 9.025 },
  { name: 'Poschiavo', lat: 46.327, lng: 10.059 },
  { name: 'Scuol', lat: 46.797, lng: 10.284 },
  { name: 'Davos', lat: 46.801, lng: 9.836 },
  { name: 'St Moritz', lat: 46.498, lng: 9.838 },
  { name: 'Chur', lat: 46.851, lng: 9.532 },
  { name: 'Interlaken', lat: 46.686, lng: 7.863 },
  { name: 'Bern', lat: 46.948, lng: 7.447 },
  { name: 'Neuchâtel', lat: 46.99, lng: 6.931 },
  { name: 'La Chaux-de-Fonds', lat: 47.1, lng: 6.826 },
  { name: 'Lucerne', lat: 47.05, lng: 8.307 },
  { name: 'Delémont', lat: 47.366, lng: 7.345 },
  { name: 'Zürich', lat: 47.377, lng: 8.54 },
  { name: 'St Gallen', lat: 47.424, lng: 9.377 },
  { name: 'Winterthur', lat: 47.5, lng: 8.724 },
  { name: 'Basel', lat: 47.559, lng: 7.588 },
  { name: 'Kreuzlingen', lat: 47.65, lng: 9.175 },
  { name: 'Schaffhausen', lat: 47.697, lng: 8.635 },
  { name: 'Orbe', lat: 46.725, lng: 6.532 },
  { name: 'Sainte-Croix', lat: 46.822, lng: 6.502 },
  { name: 'Fleurier', lat: 46.903, lng: 6.582 },
  { name: 'Le Pont', lat: 46.666, lng: 6.331 },
  { name: 'Champéry', lat: 46.177, lng: 6.87 },
  { name: 'Morgins', lat: 46.237, lng: 6.858 },
  { name: 'Orsières', lat: 46.029, lng: 7.146 },
  { name: 'Verbier', lat: 46.096, lng: 7.228 },
  { name: 'Bourg-St-Pierre', lat: 45.949, lng: 7.207 },
  { name: 'Fionnay', lat: 46.032, lng: 7.309 },
  { name: 'Arolla', lat: 45.996, lng: 7.48 },
];

const NOT_SWITZERLAND: Point[] = [
  { name: 'Chamonix', lat: 45.923, lng: 6.869 },
  { name: 'Annecy', lat: 45.899, lng: 6.129 },
  { name: 'Thonon-les-Bains', lat: 46.371, lng: 6.479 },
  { name: 'Évian-les-Bains', lat: 46.401, lng: 6.588 },
  { name: 'Morzine', lat: 46.179, lng: 6.706 },
  { name: 'Besançon', lat: 47.238, lng: 6.024 },
  { name: 'Aosta', lat: 45.735, lng: 7.313 },
  { name: 'Domodossola', lat: 46.116, lng: 8.292 },
  { name: 'Varese', lat: 45.82, lng: 8.825 },
  { name: 'Como', lat: 45.808, lng: 9.085 },
  { name: 'Sondrio', lat: 46.17, lng: 9.87 },
  { name: 'Feldkirch', lat: 47.238, lng: 9.6 },
  { name: 'Bregenz', lat: 47.503, lng: 9.747 },
  { name: 'Landeck', lat: 47.139, lng: 10.566 },
  { name: 'Freiburg im Breisgau', lat: 47.999, lng: 7.842 },
];

describe('the swisstopo source is asked only for tiles over Switzerland', () => {
  it.each(NOT_SWITZERLAND)('leaves out $name', (p) => {
    expect(covered(swisstopoBoxes(), p)).toBe(false);
  });

  it.each(SWITZERLAND)('still covers $name', (p) => {
    expect(covered(swisstopoBoxes(), p)).toBe(true);
  });

  it.each(SWITZERLAND)('leaves no white IGN tile over $name', (p) => {
    const ign = SATELLITE_SOURCES.ign.boxes as Box[];
    if (covered(ign, p)) expect(covered(swisstopoBoxes(), p)).toBe(true);
  });

  it('credits whoever draws Chamonix, which is IGN and not swisstopo', () => {
    expect(getCombinedSatelliteAttribution(45.923, 6.869, 14)).toBe('© IGN France');
  });

  it('still credits swisstopo over Switzerland', () => {
    expect(getCombinedSatelliteAttribution(46.233, 7.36, 14)).toBe('© swisstopo');
    expect(getCombinedSatelliteAttribution(47.377, 8.54, 14)).toBe('© swisstopo');
  });

  it('credits basemap.at over Vorarlberg, under the box that reached over it', () => {
    expect(getCombinedSatelliteAttribution(47.503, 9.747, 14)).toContain('basemap.at');
  });

  it('draws no box twice, so no tile is fetched or stored twice', () => {
    const boxes = swisstopoBoxes();
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

  it('draws every swisstopo box from the same layer position, above IGN', () => {
    const ids = getCombinedSatelliteStyle().layers.map((l) => l.id);
    const swiss = ids.filter((id) => /^satellite-layer-swisstopo(-\d+)?$/.test(id));

    expect(swiss.length).toBe(swisstopoBoxes().length);
    expect(ids.indexOf(swiss[swiss.length - 1]) - ids.indexOf(swiss[0])).toBe(swiss.length - 1);
    expect(ids.indexOf(swiss[0])).toBeGreaterThan(ids.indexOf('satellite-layer-ign-1'));
  });

  it('keeps one swisstopo entry, one template and one credit behind the boxes', () => {
    expect(SATELLITE_SOURCES.swisstopo.attribution).toBe('© swisstopo');
    expect(SATELLITE_SOURCES.swisstopo.tiles).toHaveLength(1);
  });
});
