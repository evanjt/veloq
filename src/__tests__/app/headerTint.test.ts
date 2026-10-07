/**
 * Scenario: the over-map header tints its back chevron white for a dark hero.
 * A screen with no hero draws that chevron on the theme background.
 *
 * Expected behaviour: white only over a hero, the theme's primary text otherwise.
 */

import { overMapHeaderTint } from '@/shared/app/screenHeaders';
import { colors, darkColors } from '@/theme';

describe('overMapHeaderTint', () => {
  it('is white over a hero in either theme', () => {
    expect(overMapHeaderTint({ overHero: true, isDark: false })).toBe(colors.textOnDark);
    expect(overMapHeaderTint({ overHero: true, isDark: true })).toBe(colors.textOnDark);
  });

  it('follows the theme text colour with no hero', () => {
    expect(overMapHeaderTint({ overHero: false, isDark: false })).toBe(colors.textPrimary);
    expect(overMapHeaderTint({ overHero: false, isDark: true })).toBe(darkColors.textPrimary);
  });
});
