/**
 * Resolves the colour tokens emitted by `combinedPlotData` into swatches.
 *
 * Kept apart from the prep layer so that layer stays free of theme imports
 * and can be tested without one.
 */

import { colors, darkColors, zoneColour, type ZoneColourRole } from '@/theme';
import type { BandColourToken } from './combinedPlotData';

type Role = Extract<BandColourToken, { kind: 'role' }>['role'];

/**
 * Each interval role as a fill (the band, the chip) and as the text tone of the
 * same hue (the table row's label), in each theme.
 */
const ROLE_COLOURS: Record<ZoneColourRole, Record<'light' | 'dark', Record<Role, string>>> = {
  fill: {
    light: {
      work: colors.primary,
      recovery: colors.chartBandNeutral,
      warmup: colors.chartBandWarmup,
      cooldown: colors.chartBandCooldown,
      other: colors.chartBandNeutral,
    },
    dark: {
      work: darkColors.primary,
      recovery: colors.chartBandNeutral,
      warmup: colors.chartBandWarmup,
      cooldown: colors.chartBandCooldown,
      other: colors.chartBandNeutral,
    },
  },
  text: {
    light: {
      work: colors.linkTeal,
      recovery: colors.textSecondary,
      warmup: colors.successDeep,
      cooldown: colors.chartPurpleText,
      other: colors.textSecondary,
    },
    dark: {
      work: darkColors.linkTeal,
      recovery: darkColors.textSecondary,
      warmup: darkColors.successDeep,
      cooldown: darkColors.chartPurpleText,
      other: darkColors.textSecondary,
    },
  },
};

function resolve(token: BandColourToken, isDark: boolean, role: ZoneColourRole): string {
  if (token.kind === 'zone') return zoneColour(token.zone, isDark, role);
  return ROLE_COLOURS[role][isDark ? 'dark' : 'light'][token.role];
}

/** The fill an interval is drawn in: its band, and the chip that keys it. */
export function resolveBandColour(token: BandColourToken, isDark: boolean): string {
  return resolve(token, isDark, 'fill');
}

/** The same interval colour as words, for a label set on a surface. */
export function resolveBandTextColour(token: BandColourToken, isDark: boolean): string {
  return resolve(token, isDark, 'text');
}
