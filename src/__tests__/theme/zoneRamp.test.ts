/**
 * The zone ramp has one definition. Power and heart rate read the same seven
 * intervals.icu steps, and heart rate takes all seven, so an edit to one ramp
 * cannot leave the other behind.
 */

import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import { zoneColors } from '@/theme/colors';

describe('training zone ramp', () => {
  it('gives power every step of the theme ramp, in order', () => {
    expect(POWER_ZONE_COLORS).toEqual([
      zoneColors.zone1,
      zoneColors.zone2,
      zoneColors.zone3,
      zoneColors.zone4,
      zoneColors.zone5,
      zoneColors.zone6,
      zoneColors.zone7,
    ]);
  });

  it('gives heart rate every step of the same ramp', () => {
    expect(HR_ZONE_COLORS).toEqual(POWER_ZONE_COLORS);
    expect(HR_ZONE_COLORS).toHaveLength(7);
  });

  it('carries no undefined step, which is what a renamed token would leave', () => {
    for (const step of POWER_ZONE_COLORS) {
      expect(step).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
