/**
 * Scenario: the delta chart colours time won and lost against its reference on
 * the style guide's diverging ramp.
 * Expected behaviour: seven equal bands over the plot's extent, cool for ahead
 * and warm for behind, the grey midpoint for level, in both themes.
 */

import { deltaBand, deltaColour } from '@/features/routes/lib/deltaColour';
import { colourTokens } from '@/theme';

const EXTENT = 7;

describe('deltaBand', () => {
  it('splits the extent into seven equal bands, ahead negative and behind positive', () => {
    expect(deltaBand(0, EXTENT)).toBe(0);
    expect(deltaBand(0.99, EXTENT)).toBe(0);
    expect(deltaBand(-0.99, EXTENT)).toBe(0);
    expect(deltaBand(-1, EXTENT)).toBe(-1);
    expect(deltaBand(2.9, EXTENT)).toBe(1);
    expect(deltaBand(3, EXTENT)).toBe(2);
    expect(deltaBand(-5, EXTENT)).toBe(-3);
    expect(deltaBand(7, EXTENT)).toBe(3);
  });

  it('holds the outer band past the extent and has no band for a missing value', () => {
    expect(deltaBand(40, EXTENT)).toBe(3);
    expect(deltaBand(-40, EXTENT)).toBe(-3);
    expect(deltaBand(NaN, EXTENT)).toBeNull();
    expect(deltaBand(Infinity, EXTENT)).toBeNull();
  });

  it('reads every value as level on an empty extent', () => {
    expect(deltaBand(3, 0)).toBe(0);
    expect(deltaBand(-3, -1)).toBe(0);
  });
});

describe('deltaColour', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('reads the diverging ramp in %s', (theme, isDark) => {
    const tokens = colourTokens[theme];
    expect(deltaColour(-EXTENT, EXTENT, isDark)).toBe(tokens['data-div-cool-3']);
    expect(deltaColour(-3, EXTENT, isDark)).toBe(tokens['data-div-cool-2']);
    expect(deltaColour(-1, EXTENT, isDark)).toBe(tokens['data-div-cool-1']);
    expect(deltaColour(0, EXTENT, isDark)).toBe(tokens['data-div-mid']);
    expect(deltaColour(1, EXTENT, isDark)).toBe(tokens['data-div-warm-1']);
    expect(deltaColour(3, EXTENT, isDark)).toBe(tokens['data-div-warm-2']);
    expect(deltaColour(EXTENT, EXTENT, isDark)).toBe(tokens['data-div-warm-3']);
  });

  it('never draws the orange the guide bars from a diverging scale', () => {
    for (const isDark of [false, true]) {
      for (let secs = -EXTENT; secs <= EXTENT; secs += 0.5) {
        expect(deltaColour(secs, EXTENT, isDark).toLowerCase()).not.toBe('#f97316');
      }
    }
  });

  it('draws a missing value in the muted chart colour', () => {
    expect(deltaColour(NaN, EXTENT, false)).toBe(colourTokens.light['chart-muted']);
    expect(deltaColour(NaN, EXTENT, true)).toBe(colourTokens.dark['chart-muted']);
  });
});
