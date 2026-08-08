/**
 * Resolves the colour tokens emitted by `combinedPlotData` into swatches.
 *
 * Kept apart from the prep layer so that layer stays free of theme imports
 * and can be tested without one.
 */

import { colors, darkColors } from '@/theme';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { BandColourToken } from './combinedPlotData';

const ROLE_COLOURS = {
  work: colors.primary,
  recovery: colors.chartBandNeutral,
  warmup: colors.chartBandWarmup,
  cooldown: colors.chartBandCooldown,
  other: colors.chartBandNeutral,
} as const;

export function resolveBandColour(token: BandColourToken, isDark: boolean): string {
  if (token.kind === 'role') return ROLE_COLOURS[token.role];

  const scale = token.scale === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
  // Zone 7 is near-black in the shared scale, so dark mode needs its override.
  if (isDark && token.zone === 7) return darkColors.zone7;
  return scale[Math.min(token.zone - 1, scale.length - 1)];
}
