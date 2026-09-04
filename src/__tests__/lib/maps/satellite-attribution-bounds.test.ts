/**
 * Scenario: satellite attribution must name the imagery MapLibre actually draws.
 *
 * Expected behaviour: attribution follows each source's `bounds`, which is the
 * same rectangle MapLibre clips the raster to. Anything that decides it from a
 * separate border polygon can disagree with what was drawn: Geneva falls
 * outside a transcribed Swiss border, so the credit reads IGN over swisstopo
 * tiles.
 */
import { getCombinedSatelliteAttribution } from '@/features/maps/components/mapStyles';

const HIGH_ZOOM = 14;

describe('satellite attribution follows the rendered bounds', () => {
  it('credits swisstopo in Geneva, where swisstopo tiles are served', () => {
    const attribution = getCombinedSatelliteAttribution(46.2044, 6.1432, HIGH_ZOOM);
    expect(attribution).toContain('swisstopo');
  });

  it.each([
    ['Lausanne', 46.5197, 6.6323],
    ['Zermatt', 46.0207, 7.7491],
    ['Zurich', 47.3769, 8.5417],
  ])('credits swisstopo in %s', (_name, lat, lng) => {
    expect(getCombinedSatelliteAttribution(lat, lng, HIGH_ZOOM)).toContain('swisstopo');
  });

  it.each([
    ['Strasbourg', 48.573, 7.752],
    ['Marseille', 43.296, 5.369],
    ['Nice', 43.71, 7.262],
    ['Paris', 48.8566, 2.3522],
  ])('credits IGN in %s', (_name, lat, lng) => {
    expect(getCombinedSatelliteAttribution(lat, lng, HIGH_ZOOM)).toContain('IGN');
  });

  it('always credits the global base layer', () => {
    expect(getCombinedSatelliteAttribution(-37.8136, 144.9631, HIGH_ZOOM)).toMatch(/EOX|Sentinel/i);
  });

  it('omits regional credit below the region minimum zoom', () => {
    expect(getCombinedSatelliteAttribution(46.2044, 6.1432, 3)).not.toContain('swisstopo');
  });
});
