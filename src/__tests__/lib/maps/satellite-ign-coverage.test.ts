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
  satelliteProviders,
} from '@/features/maps/components/mapStyles';

type Point = { name: string; lat: number; lng: number };

/** The north-west corner of a web-mercator tile, in degrees. */
function tileCorner(z: number, x: number, y: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (rad * 180) / Math.PI, lng };
}

/** Every bbox the engine is handed for the IGN provider. */
function ignBoxes(): [number, number, number, number][] {
  return (
    satelliteProviders('satellite-regions').find((p) => p.source === 'satellite-ign')?.boxes ?? []
  );
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
  { name: 'Pas de la Casa', lat: 42.5, lng: 1.75 },
  { name: 'Latour-de-Carol', lat: 42.46, lng: 1.88 },
  { name: 'Bourg-Madame', lat: 42.43, lng: 1.95 },
  { name: 'Eyne', lat: 42.4, lng: 2.05 },
  { name: 'Prats-de-Mollo', lat: 42.4, lng: 2.43 },
  { name: 'Le Perthus', lat: 42.46, lng: 2.9 },
  { name: 'Porté-Puymorens', lat: 42.57, lng: 1.83 },
  { name: 'Ax-les-Thermes', lat: 42.72, lng: 1.838 },
  { name: 'Luchon', lat: 42.79, lng: 0.594 },
  // The French side of the Aran ridge. IGN answers imagery here at z16, and
  // the boxes must keep it while they drop the white tiles on the Spanish side.
  { name: 'Fos', lat: 42.87, lng: 0.74 },
  { name: 'Aulus-les-Bains', lat: 42.792, lng: 1.339 },
  { name: 'Biriatou', lat: 43.33, lng: -1.745 },
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
  // answers 200 with an all-white tile that would paint over PNOA. Measured at
  // z16 on 2026-11-20: Bossòst, Les and Irun are white, Vielha is white at z15
  // and 404 at z16.
  { name: 'Vielha', lat: 42.702, lng: 0.797 },
  { name: 'Bossòst', lat: 42.786, lng: 0.692 },
  { name: 'Les', lat: 42.812, lng: 0.71 },
  { name: 'Irun', lat: 43.338, lng: -1.789 },
  { name: 'Bujaruelo valley', lat: 42.69, lng: -0.1 },
  { name: 'Pineta cirque', lat: 42.685, lng: 0.09 },
  { name: 'Orbaizeta', lat: 42.975, lng: -1.225 },
  { name: 'Valladolid', lat: 41.652, lng: -4.724 },
  // Andorra and the Spanish Cerdanya, measured at z16: IGN answers an
  // all-white tile at each of these and 404 further inside Andorra.
  { name: 'Andorra north-east', lat: 42.56, lng: 1.45 },
  { name: 'Andorra north', lat: 42.58, lng: 1.45 },
  { name: 'Andorra Ordino', lat: 42.57, lng: 1.47 },
  { name: 'Andorra border ridge', lat: 42.6, lng: 1.6 },
  { name: 'Andorra Canillo', lat: 42.56, lng: 1.6 },
  { name: 'Andorra Pas de la Casa side', lat: 42.5, lng: 1.7 },
  { name: 'Andorra la Vella', lat: 42.507, lng: 1.522 },
  { name: 'La Seu d’Urgell', lat: 42.358, lng: 1.46 },
  { name: 'Puigcerdà west', lat: 42.43, lng: 1.9 },
  { name: 'Cerdanya below Llívia', lat: 42.4, lng: 1.9 },
  { name: 'Spanish Cerdanya south', lat: 42.36, lng: 1.95 },
  { name: 'Ripollès edge', lat: 42.4, lng: 2.3 },
  { name: 'Alt Empordà', lat: 42.44, lng: 3.0 },
];

describe('the IGN source is asked only for tiles over France', () => {
  it('leaves out the tile a test handset logged 247 dead fetches around', () => {
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

  vaultIt('ranks IGN under swisstopo, which covers the residual border overlap', () => {
    const names = satelliteProviders('satellite-regions').map((p) => p.source);

    expect(names.indexOf('satellite-ign')).toBeGreaterThan(names.indexOf('satellite-swisstopo'));
  });

  it('credits IGN over France and nothing over Turin, where it draws nothing', () => {
    // Chamonix as well as Briançon: the swisstopo boxes stop at the border, so
    // the credit there no longer names swisstopo over IGN's own imagery.
    expect(getCombinedSatelliteAttribution(44.9, 6.64, 14)).toContain('IGN');
    expect(getCombinedSatelliteAttribution(45.923, 6.869, 14)).toContain('IGN');
    expect(getCombinedSatelliteAttribution(45.07, 7.686, 14)).not.toContain('IGN');
    // Barcelona is PNOA's, and IGN was credited over it while the box reached
    // the Ebro.
    expect(getCombinedSatelliteAttribution(41.385, 2.173, 14)).not.toContain('IGN');
  });

  vaultIt('keeps one IGN entry, one template and one credit behind the boxes', () => {
    expect(SATELLITE_SOURCES.ign.attribution).toBe('© IGN');
    expect(SATELLITE_SOURCES.ign.tiles).toHaveLength(1);
  });
});
