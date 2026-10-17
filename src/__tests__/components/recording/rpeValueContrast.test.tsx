/**
 * Scenario: the effort value on the recording review took its ramp hue, the
 * same green to red the track fills with, and green on white is 2.28:1.
 *
 * Expected behaviour: the value reads at 4.5:1 on every surface of its theme
 * at every effort, and the hue stays on the thumb and the fill.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RpeSlider } from '@/features/recording/components/RpeSlider';
import { colors, darkColors, rpeRamp } from '@/theme';

const theme = { isDark: false };

jest.mock('@/shared/app', () => ({ useTheme: () => theme }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

function relativeLuminance(hex: string): number {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = {
  light: [colors.surface, colors.surfacePage, colors.surfaceInput],
  dark: [darkColors.surface, darkColors.surfacePage, darkColors.surfaceRaised],
};

async function valueInk(value: number): Promise<string> {
  const { getByText } = await render(
    <RpeSlider value={value} onValueChange={jest.fn()} textSecondary={colors.textSecondary} />
  );
  const label = getByText(new RegExp(`^${value} - `));
  return StyleSheet.flatten(label.props.style).color as string;
}

describe('the effort value on the review', () => {
  it.each([1, 3, 5, 7, 9, 10])('reads at 4.5:1 at effort %i in both themes', async (value) => {
    for (const mode of ['light', 'dark'] as const) {
      theme.isDark = mode === 'dark';
      const ink = await valueInk(value);
      for (const surface of SURFACES[mode]) {
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the effort hue on the thumb', async () => {
    theme.isDark = false;
    const { toJSON } = await render(
      <RpeSlider value={1} onValueChange={jest.fn()} textSecondary={colors.textSecondary} />
    );

    expect(JSON.stringify(toJSON())).toContain(rpeRamp[0]);
  });
});
