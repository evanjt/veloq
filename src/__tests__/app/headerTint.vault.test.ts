/**
 * Scenario: a map-hero detail screen floats the platform's back control and the status bar over
 * its hero, then scrolls the hero away and the pale page passes under the same transparent bar.
 * White glyphs that read over the darkened hero vanish on the light page.
 *
 * Expected behaviour: one owner answers tint, status bar style and header background together.
 * Over the hero it is white glyphs on a transparent bar in either theme; past the hero it is the
 * theme's text on the theme's surface, with the status bar style that reads on that surface.
 */

import { mapHeroChrome } from '@/shared/app/screenHeaders';
import { colors, darkColors } from '@/theme';

describe('mapHeroChrome', () => {
  it('draws white glyphs on a transparent bar over the hero in either theme', () => {
    for (const isDark of [false, true]) {
      expect(mapHeroChrome({ scrolledPastHero: false, isDark })).toEqual({
        tint: colors.textOnFill,
        statusBarStyle: 'light',
        headerBackgroundColor: 'transparent',
      });
    }
  });

  it('takes the light theme surface and dark glyphs once the hero has scrolled away', () => {
    expect(mapHeroChrome({ scrolledPastHero: true, isDark: false })).toEqual({
      tint: colors.textPrimary,
      statusBarStyle: 'dark',
      headerBackgroundColor: colors.surface,
    });
  });

  it('takes the dark theme surface and light glyphs once the hero has scrolled away', () => {
    expect(mapHeroChrome({ scrolledPastHero: true, isDark: true })).toEqual({
      tint: darkColors.textPrimary,
      statusBarStyle: 'light',
      headerBackgroundColor: darkColors.surface,
    });
  });
});
