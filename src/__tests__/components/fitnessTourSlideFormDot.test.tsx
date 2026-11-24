/**
 * Scenario: the App Tour's fitness slide keys its form line with a dot, and the
 * dot was drawn in the light theme's optimal-zone colour whichever theme was
 * on, so in the dark tour it was a light swatch on the dark card.
 *
 * Expected behaviour: the form dot takes the optimal-zone colour of the active
 * theme, and the light colour appears only on the light tour.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { FitnessHeroSlide } from '@/features/settings/components/whatsNew/FitnessHeroSlide';
import { colors, darkColors } from '@/theme';

let mockDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

/** Every solid background colour the slide's views are drawn in. */
function backgroundColours(): string[] {
  return screen.root
    .findAllByType('View' as never)
    .map((node) => StyleSheet.flatten((node.props as { style?: unknown }).style as never))
    .map((style) => (style as { backgroundColor?: string } | undefined)?.backgroundColor)
    .filter((colour): colour is string => typeof colour === 'string');
}

describe.each([
  ['light', false],
  ['dark', true],
] as const)('the fitness tour slide in %s', (_theme, isDark) => {
  const palette = isDark ? darkColors : colors;
  const other = isDark ? colors : darkColors;

  beforeEach(() => {
    mockDark = isDark;
  });

  it("draws the form key dot in this theme's optimal-zone colour", async () => {
    await render(<FitnessHeroSlide />);

    const backgrounds = backgroundColours();
    expect(backgrounds).toContain(palette.formOptimal);
    expect(backgrounds).not.toContain(other.formOptimal);
  });
});
