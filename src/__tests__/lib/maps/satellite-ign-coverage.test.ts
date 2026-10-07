/**
 * Scenario: the satellite style over the Franco-Swiss border, where the IGN
 * source used to declare one metropolitan-France bbox that reached to 9.56°E
 * and so covered Geneva, Valais and the Bernese Oberland.
 * Expected behaviour: MapLibre never asks IGN for a tile outside France, and
 * still asks it for the French side of the same mountains. IGN serves French
 * orthophotos only, so a tile over Valais is a 404 the map cannot use and a
 * request no user asked for.
 */

import {
  SATELLITE_SOURCES,
  getCombinedSatelliteAttribution,
  getCombinedSatelliteStyle,
} from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };

/** The north-west corner of a web-mercator tile, in degrees. */
function tileCorner(z: number, x: number, y: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (rad * 180) / Math.PI, lng };
}

/** Every bbox the style hands MapLibre for the IGN source. */
function ignBoxes(): [number, number, number, number][] {
  const style = getCombinedSatelliteStyle();
  return Object.entries(style.sources)
    .filter(([id]) => /^satellite-ign(-\d+)?$/.test(id))
    .map(([, source]) => source.bounds)
    .filter((b): b is [number, number, number, number] => b !== undefined);
}

function covered(boxes: [number, number, number, number][], p: Point): boolean {
  return boxes.some(
    ([west, south, east, north]) =>
      p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north
  );
}

const FRANCE: Point[] = [
  { name: 'Chamonix', lat: 45.923, lng: 6.869 },
  { name: 'Thonon-les-Bains', lat: 46.371, lng: 6.479 },
  { name: 'Briançon', lat: 44.9, lng: 6.64 },
  { name: 'Menton', lat: 43.776, lng: 7.524 },
  { name: 'Ajaccio', lat: 41.919, lng: 8.739 },
  { name: 'Mulhouse', lat: 47.75, lng: 7.339 },
  { name: 'Strasbourg', lat: 48.573, lng: 7.752 },
  { name: 'Besançon', lat: 47.238, lng: 6.024 },
  { name: 'Paris', lat: 48.857, lng: 2.352 },
  { name: 'Brest', lat: 48.39, lng: -4.49 },
  { name: 'Lille', lat: 50.63, lng: 3.06 },
  // The French side of the Pyrenees, which the south-western staircase has to
  // keep while it drops the Ebro.
  { name: 'Perpignan', lat: 42.698, lng: 2.895 },
  { name: 'Cerbère', lat: 42.44, lng: 3.17 },
  { name: 'Font-Romeu', lat: 42.505, lng: 2.038 },
  { name: 'Ax-les-Thermes', lat: 42.72, lng: 1.838 },
  { name: 'Luchon', lat: 42.79, lng: 0.594 },
  { name: 'Cauterets', lat: 42.89, lng: -0.114 },
  { name: 'Gavarnie', lat: 42.733, lng: -0.011 },
  { name: 'Gèdre', lat: 42.787, lng: 0.02 },
  { name: 'Piau-Engaly', lat: 42.785, lng: 0.157 },
  { name: 'Aragnouet', lat: 42.79, lng: 0.23 },
  { name: 'Sainte-Engrâce', lat: 43.0, lng: -0.811 },
  { name: 'Larrau', lat: 43.018, lng: -0.955 },
  { name: 'Iraty chalets', lat: 43.03, lng: -1.07 },
  { name: 'Pau', lat: 43.296, lng: -0.37 },
  { name: 'Hendaye', lat: 43.365, lng: -1.775 },
  { name: 'Marseille', lat: 43.296, lng: 5.37 },
  { name: 'Bonifacio', lat: 41.387, lng: 9.159 },
];

const NOT_FRANCE: Point[] = [
  { name: 'Sion', lat: 46.233, lng: 7.36 },
  { name: 'Zermatt', lat: 46.02, lng: 7.749 },
  { name: 'Bern', lat: 46.948, lng: 7.447 },
  { name: 'Zürich', lat: 47.377, lng: 8.54 },
  { name: 'Basel', lat: 47.559, lng: 7.588 },
  { name: 'Turin', lat: 45.07, lng: 7.686 },
  // Spain and Andorra, which PNOA covers and IGN does not. The western and
  // southern edges were still one metropolitan box after the eastern staircase
  // went in, so every one of these was asked of IGN first and answered 404.
  { name: 'Barcelona', lat: 41.385, lng: 2.173 },
  { name: 'Zaragoza', lat: 41.649, lng: -0.888 },
  { name: 'Girona', lat: 41.983, lng: 2.824 },
  { name: 'Lleida', lat: 41.617, lng: 0.62 },
  { name: 'Pamplona', lat: 42.813, lng: -1.646 },
  { name: 'San Sebastián', lat: 43.321, lng: -1.984 },
  { name: 'Huesca', lat: 42.14, lng: -0.409 },
  { name: 'Torla', lat: 42.637, lng: -0.105 },
  { name: 'Bielsa', lat: 42.63, lng: 0.21 },
  { name: 'Isaba', lat: 42.857, lng: -0.87 },
  // Spanish ground inside the extents of the French-valley boxes, where IGN
  // answers 200 with an all-white tile that would paint over PNOA.
  { name: 'Bujaruelo valley', lat: 42.69, lng: -0.1 },
  { name: 'Pineta cirque', lat: 42.685, lng: 0.09 },
  { name: 'Orbaizeta', lat: 42.975, lng: -1.225 },
  { name: 'Salamanca', lat: 40.966, lng: -5.664 },
];

describe('the IGN source is asked only for tiles over France', () => {
  it('leaves out the tile the S22 logged 247 dead fetches around', () => {
    // 13/4277/2894, one of the tiles `[basemap] satellite-ign ... 404` named
    // while panning the Valais demo rides.
    const { lat, lng } = tileCorner(13, 4277, 2894);
    expect(covered(ignBoxes(), { name: 'Valais tile', lat, lng })).toBe(false);
  });

  it.each(NOT_FRANCE)('leaves out $name', (p) => {
    expect(covered(ignBoxes(), p)).toBe(false);
  });

  it.each(FRANCE)('still covers $name', (p) => {
    expect(covered(ignBoxes(), p)).toBe(true);
  });

  it('draws every IGN box from the same layer position and at the same minzoom', () => {
    const style = getCombinedSatelliteStyle();
    const ids = style.layers.map((l) => l.id);
    const ign = ids.filter((id) => /^satellite-layer-ign(-\d+)?$/.test(id));

    expect(ign.length).toBe(ignBoxes().length);
    // Contiguous: nothing else is stacked between two pieces of one source.
    expect(ids.indexOf(ign[ign.length - 1]) - ids.indexOf(ign[0])).toBe(ign.length - 1);
    // Under swisstopo, which is what covers the residual border overlap.
    expect(ids.indexOf('satellite-layer-swisstopo-1')).toBeGreaterThan(ids.indexOf(ign[0]));
  });

  it('keeps the valleys no rectangle can cut from the French side', () => {
    // The Val d'Aran and Andorra sit north of the crest, inside the same
    // rectangle as Luchon and Font-Romeu, 15 and 20 km away. Dropping them
    // costs those two their imagery; keeping them costs a few requests PNOA
    // and the Andorran orthophoto answer underneath.
    expect(covered(ignBoxes(), { name: 'Vielha', lat: 42.702, lng: 0.797 })).toBe(true);
    expect(covered(ignBoxes(), { name: 'Andorra la Vella', lat: 42.507, lng: 1.522 })).toBe(true);
  });

  it('credits IGN over France and nothing over Turin, where it draws nothing', () => {
    // Chamonix as well as Briançon: the swisstopo boxes stop at the border, so
    // the credit there no longer names swisstopo over IGN's own imagery.
    expect(getCombinedSatelliteAttribution(44.9, 6.64, 14)).toContain('IGN');
    expect(getCombinedSatelliteAttribution(45.923, 6.869, 14)).toContain('IGN');
    expect(getCombinedSatelliteAttribution(45.07, 7.686, 14)).not.toContain('IGN');
    // Barcelona is PNOA's, and IGN was credited over it while the box reached
    // the Ebro.
    expect(getCombinedSatelliteAttribution(41.385, 2.173, 14)).not.toContain('IGN France');
  });

  it('keeps one IGN entry, one template and one credit behind the boxes', () => {
    expect(SATELLITE_SOURCES.ign.attribution).toBe('© IGN France');
    expect(SATELLITE_SOURCES.ign.tiles).toHaveLength(1);
  });
});
