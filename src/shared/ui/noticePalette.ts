/**
 * The one tone palette a notice is drawn from, in the top slot and inside a
 * screen alike, so a banner and an inline notice of one tone cannot disagree.
 */

import { colors, darkColors } from '@/theme';

/**
 * A failure, a notice the athlete may act on, a state they chose, or a wait
 * that ends on its own.
 */
export type NoticeTone = 'error' | 'warning' | 'info' | 'neutral';

/** The notice tones and a good outcome, which a signal level can also be. */
export type PaletteTone = NoticeTone | 'success';

export interface NoticePalette {
  bg: string;
  /** An edge around the ground, for the one tone whose ground is the page colour. */
  border?: string;
  text: string;
  subtext: string;
  icon: string;
}

/**
 * Each tone is its status tint with the body ink on it and the tone's own
 * text colour as the icon, so a failure, a caution and a notice differ by hue
 * and each still pairs its colour with an icon and words. Neutral is the
 * surface, edged so it parts from the page under it. The pairs are measured in
 * `TINT_GROUNDS`.
 */
export function noticePalette(tone: PaletteTone, isDark: boolean): NoticePalette {
  const p = isDark ? darkColors : colors;
  const ink = { text: p.textPrimary, subtext: p.textSecondary };
  const grounds: Record<PaletteTone, Omit<NoticePalette, 'text' | 'subtext'>> = {
    error: { bg: p.errorBg, icon: p.errorDeep },
    warning: { bg: p.warningBg, icon: p.warningAmber },
    info: { bg: p.infoBg, icon: p.infoText },
    success: { bg: p.successBg, icon: p.successDeep },
    neutral: { bg: p.surface, border: p.border, icon: p.textSecondary },
  };
  return { ...grounds[tone], ...ink };
}
