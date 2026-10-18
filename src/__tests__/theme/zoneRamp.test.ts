/**
 * The zone ramp has one owner. Power and heart rate read the same seven
 * intervals.icu steps through `zoneColour`, and each scheme reads its own fill
 * ladder, so no surface can paint one scheme's steps on the other's ground.
 */

import { colourTokens } from '@/theme';
import { zoneColorsDark, zoneColorsLight } from '@/theme/colors';
import { zoneColour } from '@/theme/zoneColour';

const ZONES = [1, 2, 3, 4, 5, 6, 7];

describe('training zone ramp', () => {
  it('gives the light scheme the light fill ladder, in order', () => {
    expect(ZONES.map((z) => zoneColour(z, false))).toEqual(Object.values(zoneColorsLight));
  });

  it('gives the dark scheme the dark fill ladder, in order', () => {
    expect(ZONES.map((z) => zoneColour(z, true))).toEqual([
      zoneColorsDark.zone1,
      zoneColorsDark.zone2,
      zoneColorsDark.zone3,
      zoneColorsDark.zone4,
      zoneColorsDark.zone5,
      zoneColorsDark.zone6,
      zoneColorsDark.zone7,
    ]);
    expect(zoneColour(7, true)).not.toBe(zoneColour(7, false));
  });

  it('reads each step from the token file, in both schemes', () => {
    for (const isDark of [false, true]) {
      const tokens = colourTokens[isDark ? 'dark' : 'light'];
      expect(ZONES.map((z) => zoneColour(z, isDark))).toEqual(
        ZONES.map((z) => tokens[`zone-${z}` as keyof typeof tokens])
      );
    }
  });

  it('carries no undefined step, which is what a renamed token would leave', () => {
    for (const isDark of [false, true]) {
      for (const z of ZONES) {
        expect(zoneColour(z, isDark)).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });
});
