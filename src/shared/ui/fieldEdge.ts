/**
 * The edge a text field draws, decided once for every platform's field.
 *
 * A refused value keeps the error colour whatever the focus, so the reason the
 * form will not go on stays on screen while the athlete corrects it. Focus
 * widens the edge to the 2 pt focus ring, which the field draws inside its
 * box so the row does not move.
 */

import { stroke, themePalette } from '@/theme';

/** Style-shaped, so a field spreads it straight onto its box or outline. */
export interface FieldEdge {
  borderColor: string;
  borderWidth: number;
}

export function fieldEdge({
  error,
  focused,
  isDark,
}: {
  error: boolean;
  focused: boolean;
  isDark: boolean;
}): FieldEdge {
  const palette = themePalette(isDark);
  if (error) return { borderColor: palette.errorText, borderWidth: stroke.one };
  if (focused) return { borderColor: palette.focusRing, borderWidth: stroke.two };
  return { borderColor: palette.controlBoundary, borderWidth: stroke.one };
}
