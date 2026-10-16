import { colorWithOpacity, ink } from '@/theme';

/** A tour picture's panel is a faint wash of the opposite ink, a touch stronger on dark. */
const PANEL_ALPHA_DARK = 0.06;
const PANEL_ALPHA_LIGHT = 0.04;

/** The fill behind every tour slide's picture, so the slides read as one set. */
export function tourPanelColour(isDark: boolean): string {
  return isDark
    ? colorWithOpacity(ink.white, PANEL_ALPHA_DARK)
    : colorWithOpacity(ink.black, PANEL_ALPHA_LIGHT);
}
