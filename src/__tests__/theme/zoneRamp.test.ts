/**
 * The zone ramp has one owner. Power and heart rate read the same seven
 * intervals.icu steps through `zoneColour`, and each scheme reads its own fill
 * ladder, so no surface can paint one scheme's steps on the other's ground.
 */

import { zoneColors, zoneColorsDark, zoneColorsLight } from '@/theme/colors';
import { zoneColour } from '@/theme/zoneColour';

const ZONES = [1, 2, 3, 4, 5, 6, 7];

describe('training zone ramp', () => {
  it('gives the light scheme the light fill ladder, in order', () => {
    expect(ZONES.map((z) => zoneColour(z, false, 'fill'))).toEqual(Object.values(zoneColorsLight));
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
