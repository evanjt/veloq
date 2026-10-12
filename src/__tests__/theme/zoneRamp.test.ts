/**
 * The zone ramp has one owner. Power and heart rate read the same seven
 * intervals.icu steps through `zoneColour`, and the dark scheme reads its own
 * fill ladder, so no surface can paint the light steps on a dark ground.
 */

import { zoneColors, zoneColorsDark } from '@/theme/colors';
import { zoneColour } from '@/theme/zoneColour';

const ZONES = [1, 2, 3, 4, 5, 6, 7];

describe('training zone ramp', () => {
  it('gives the light scheme every step of the theme ramp, in order', () => {
    expect(ZONES.map((z) => zoneColour(z, false, 'fill'))).toEqual(Object.values(zoneColors));
  });

  it('gives the dark scheme the dark fill ladder, in order', () => {
    expect(ZONES.map((z) => zoneColour(z, true, 'fill'))).toEqual([
      zoneColorsDark.zone1,
      zoneColorsDark.zone2,
      zoneColorsDark.zone3,
      zoneColorsDark.zone4,
      zoneColorsDark.zone5,
      zoneColorsDark.zone6,
      zoneColorsDark.zone7,
    ]);
    expect(zoneColour(7, true, 'fill')).not.toBe(zoneColors.zone7);
  });

  it('carries no undefined step, which is what a renamed token would leave', () => {
    for (const isDark of [false, true]) {
      for (const z of ZONES) {
        expect(zoneColour(z, isDark, 'fill')).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});
