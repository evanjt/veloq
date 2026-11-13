/**
 * Scenario: a palette key that no screen draws still reads as a design decision,
 * so the next change is made to it rather than to the role that is actually on
 * screen, and the role check has to account for it.
 *
 * Expected behaviour: the keys with no reader outside the theme are gone from
 * the palettes and from the theme's exports.
 */

import * as theme from '@/theme';
import * as palette from '@/theme/colors';

const UNREAD_PALETTE_KEYS = [
  'chartGreen',
  'chartYellow',
  'chartIndigo',
  'chartRed',
  'sameDirection',
  'eventPriorityA',
  'eventPriorityB',
  'eventPriorityC',
  'workoutCooldown',
];

const UNREAD_EXPORTS = ['mapStyleSwatch', 'mapStyleSwatchIcon', 'gradients', 'glows'];

describe('a colour key nothing reads is not in the palette', () => {
  it.each(UNREAD_PALETTE_KEYS)('%s is in neither theme', (key) => {
    expect(Object.keys(palette.colors)).not.toContain(key);
    expect(Object.keys(palette.darkColors)).not.toContain(key);
  });

  it('draws no user location colour on the map layers', () => {
    expect(Object.keys(palette.mapLayerColors)).not.toContain('userLocation');
  });

  it.each(UNREAD_EXPORTS)('%s is not exported', (name) => {
    expect(Object.keys(palette)).not.toContain(name);
    expect(Object.keys(theme)).not.toContain(name);
  });
});
