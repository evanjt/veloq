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
    // The swisstopo layer declares minzoom 8 while REGIONS.switzerland says 6,
    // so between the two nothing swiss is drawn and nothing swiss is credited.
    const layer = getCombinedSatelliteStyle().layers.find(
      (l) => l.id === 'satellite-layer-swisstopo'
    );
    expect(layer && 'minzoom' in layer ? layer.minzoom : null).toBe(8);

    expect(getCombinedSatelliteAttribution(46.23, 7.36, 7)).not.toContain('swisstopo');
    expect(getCombinedSatelliteAttribution(46.23, 7.36, 8)).toContain('swisstopo');
  });

  it('credits one source per point, never a list', () => {
    expect(getCombinedSatelliteAttribution(46.23, 7.36, 14)).not.toContain('|');
    expect(getCombinedSatelliteAttribution(48.8566, 2.3522, 14)).not.toContain('|');
  });
});
