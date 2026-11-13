/**
 * Scenario: the field's focused edge was the action blue at the same 1 pt as
 * the resting edge, so in dark the focus mark fell under 3:1 on the field and
 * a focused field read the same as an idle one.
 *
 * Expected behaviour: an idle field is edged in the control boundary at 1 pt, a
 * focused one in the focus ring at 2 pt, a refused one in the error text colour
 * at 1 pt whatever its focus, and every edge holds 3:1 on the field's ground.
 */

import { colors, darkColors, stroke } from '@/theme';
import { fieldEdge } from '@/shared/ui/fieldEdge';

import { contrastRatio } from '../__shared__/contrast';

const THEMES = [
  ['light', false, colors],
  ['dark', true, darkColors],
] as const;

describe.each(THEMES)('fieldEdge in %s', (_name, isDark, palette) => {
  it('edges an idle field in the control boundary at 1 pt', () => {
    expect(fieldEdge({ error: false, focused: false, isDark })).toEqual({
      borderColor: palette.controlBoundary,
      borderWidth: stroke.one,
    });
  });

  it('edges a focused field in the focus ring at 2 pt', () => {
    expect(fieldEdge({ error: false, focused: true, isDark })).toEqual({
      borderColor: palette.focusRing,
      borderWidth: stroke.two,
    });
  });

  it('edges a refused field in the error colour at 1 pt, focused or not', () => {
    const refused = { borderColor: palette.errorText, borderWidth: stroke.one };
    expect(fieldEdge({ error: true, focused: false, isDark })).toEqual(refused);
    expect(fieldEdge({ error: true, focused: true, isDark })).toEqual(refused);
  });

  it('holds 3:1 on the field ground in every state', () => {
    for (const error of [false, true]) {
      for (const focused of [false, true]) {
        const { borderColor } = fieldEdge({ error, focused, isDark });
        expect(contrastRatio(borderColor, palette.surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
