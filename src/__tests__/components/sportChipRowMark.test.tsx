/**
 * Scenario: a selected sport chip was filled in its family colour with a label
 * on it. Four of the family fills cannot carry a label at 4.5:1 in any ink
 * (light run, water and foot, dark foot), so whichever ink was chosen some
 * selected chip failed.
 *
 * Expected behaviour: a sport chip is the plain selector chip, `controlOn`
 * under `textOnFill` when selected and the neutral fill under the secondary
 * text when not, and the sport is told by a leading dot. The dot is the family
 * colour on a family chip and the sport's fixed shade within its family on a
 * sport chip, in both states and both themes.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SportChipRow } from '@/shared/ui/SportChipRow';
import { SPORT_FAMILY_ORDER } from '@/shared/activity/sportCategories';
import { colors, darkColors, sportFamilyColours } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  ['light', false],
  ['dark', true],
] as const;

const FAMILY_CHIPS = SPORT_FAMILY_ORDER.map((family) => ({
  key: family,
  label: family,
  testID: `chip-${family}`,
}));

async function renderFamilies(isDark: boolean, selected: ReadonlySet<string>) {
  mockIsDark = isDark;
  const view = await render(
    <SportChipRow chips={FAMILY_CHIPS} selected={selected} onToggle={() => {}} />
  );
  mockIsDark = false;
  return view;
}

describe.each(THEMES)('a sport chip in the %s theme', (theme, isDark) => {
  const palette = isDark ? darkColors : colors;
  const families = sportFamilyColours[theme];

  it.each(SPORT_FAMILY_ORDER)(
    '%s selected is the control-on chip with its label at 4.5:1 and the family dot',
    async (family) => {
      const { getByTestId } = await renderFamilies(isDark, new Set(SPORT_FAMILY_ORDER));
      const ground = styleOf(getByTestId(`chip-${family}`)).backgroundColor as string;
      const ink = styleOf(getByTestId(`chip-${family}-label`)).color as string;

      expect(ground).toBe(palette.controlOn);
      expect(ink).toBe(colors.textOnFill);
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(4.5);
      expect(styleOf(getByTestId(`chip-${family}-mark`)).backgroundColor).toBe(families[family][0]);
    }
  );

  it.each(SPORT_FAMILY_ORDER)(
    '%s unselected keeps the neutral chip, its label in the secondary text and the family dot',
    async (family) => {
      const { getByTestId } = await renderFamilies(isDark, new Set());

      expect(styleOf(getByTestId(`chip-${family}`)).backgroundColor).toBe(palette.fillNeutral);
      expect(styleOf(getByTestId(`chip-${family}-label`)).color).toBe(palette.textSecondary);
      expect(styleOf(getByTestId(`chip-${family}-mark`)).backgroundColor).toBe(families[family][0]);
    }
  );

  it("draws a sport's chip in that sport's fixed shade of its family, selected or not", async () => {
    mockIsDark = isDark;
    const { getByTestId } = await render(
      <SportChipRow
        chips={['Ride', 'GravelRide', 'VirtualRide', 'Yoga', 'NotASport'].map((type) => ({
          key: type,
          label: type,
          testID: `chip-${type}`,
        }))}
        value="GravelRide"
        onSelect={() => {}}
      />
    );
    mockIsDark = false;
    const dot = (type: string) => styleOf(getByTestId(`chip-${type}-mark`)).backgroundColor;

    expect(dot('Ride')).toBe(families.Ride[0]);
    expect(dot('GravelRide')).toBe(families.Ride[1]);
    expect(dot('VirtualRide')).toBe(families.Ride[2]);
    expect(dot('Yoga')).toBe(families.Strength[1]);
    expect(dot('NotASport')).toBe(families.Other[0]);
    expect(styleOf(getByTestId('chip-GravelRide')).backgroundColor).toBe(palette.controlOn);
  });

  it('draws a chip keyed by its own name in the family it names', async () => {
    mockIsDark = isDark;
    const { getByTestId } = await render(
      <SportChipRow
        chips={[{ key: 'Cycling', category: 'Ride', label: 'Cycling', testID: 'chip-Cycling' }]}
        value="Cycling"
        onSelect={() => {}}
      />
    );
    mockIsDark = false;

    expect(styleOf(getByTestId('chip-Cycling')).backgroundColor).toBe(palette.controlOn);
    expect(styleOf(getByTestId('chip-Cycling-mark')).backgroundColor).toBe(families.Ride[0]);
  });
});
