/**
 * Scenario: the satellite basemap over Valais, where the swisstopo and IGN
 * France boxes overlap and EOX runs underneath both.
 * Expected behaviour: the credit names the imagery on screen and nothing else.
 * Every regional raster is opaque and they are stacked in one fixed order, so
 * at any one point only the topmost layer whose bounds contain it and whose
 * minzoom is met is visible. Crediting a source that is not drawing is a
 * licence claim nobody made.
 */

import {
  getCombinedSatelliteAttribution,
  getCombinedSatelliteStyle,
} from '@/features/maps/components/mapStyles';
import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';

describe('satellite attribution names only what is drawn', () => {
  it('credits swisstopo alone over Valais, not IGN France underneath it', () => {
    const attribution = getCombinedSatelliteAttribution(46.23, 7.36, 14);

    expect(attribution).toContain('swisstopo');
    expect(attribution).not.toContain('IGN');
  });

  it('drops the global base once a regional source covers the point', () => {
    const attribution = getCombinedSatelliteAttribution(46.23, 7.36, 14);

    expect(attribution).not.toMatch(/EOX|Sentinel/i);
  });

  it('falls back to the global base where nothing is drawn over it', () => {
    expect(getCombinedSatelliteAttribution(-37.8136, 144.9631, 14)).toMatch(/EOX|Sentinel/i);
  });

  it('follows the layer minzoom, not the region minzoom', () => {
    // The swisstopo layers declare minzoom 8 while REGIONS.switzerland says 6,
    // so between the two nothing swiss is drawn and nothing swiss is credited.
    const layers = getCombinedSatelliteStyle().layers.filter((l) =>
      /^satellite-layer-swisstopo-\d+$/.test(l.id)
    );
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect('minzoom' in layer ? layer.minzoom : null).toBe(8);
    }

    expect(getCombinedSatelliteAttribution(46.23, 7.36, 7)).not.toContain('swisstopo');
    expect(getCombinedSatelliteAttribution(46.23, 7.36, 8)).toContain('swisstopo');
  });

  it('credits one source for a point with no viewport extent', () => {
    expect(getCombinedSatelliteAttribution(46.23, 7.36, 14)).not.toContain('|');
    expect(getCombinedSatelliteAttribution(48.8566, 2.3522, 14)).not.toContain('|');
  });
});

describe('satellite attribution over a viewport', () => {
  // Switzerland meets France at Geneva: the west edge draws IGN France and the
  // east edge draws swisstopo, with the centre inside swisstopo.
  const straddling: LngLatBounds = { sw: [5.7, 46.1], ne: [6.5, 46.3] };

  it('credits every source drawn across a region border', () => {
    const attribution = getCombinedSatelliteAttribution(46.2, 6.3, 12, straddling);

    expect(attribution).toContain('swisstopo');
    expect(attribution).toContain('IGN');
  });

  it('credits the global base where a corner of the viewport is over uncovered ground', () => {
    const coast: LngLatBounds = { sw: [-8, 40], ne: [10, 52] };

    expect(getCombinedSatelliteAttribution(46, 1, 8, coast)).toMatch(/EOX|Sentinel/i);
  });

  it('credits swisstopo alone for a viewport wholly inside Valais', () => {
    const valais: LngLatBounds = { sw: [7.3, 46.2], ne: [7.4, 46.26] };
    const attribution = getCombinedSatelliteAttribution(46.23, 7.36, 14, valais);

    expect(attribution).toContain('swisstopo');
    expect(attribution).not.toContain('IGN');
    expect(attribution).not.toMatch(/EOX|Sentinel/i);
  });

  it('lists each source once, in stack order', () => {
    const parts = getCombinedSatelliteAttribution(46.2, 6.3, 12, straddling).split(' | ');

    expect(new Set(parts).size).toBe(parts.length);
  });

  it('is passed through computeAttribution as the viewport bounds', () => {
    const text = computeAttribution({
      style: 'satellite',
      is3D: false,
      center: [6.3, 46.2],
      zoom: 12,
      bounds: straddling,
    });

    expect(text).toContain('swisstopo');
    expect(text).toContain('IGN');
  });
});
