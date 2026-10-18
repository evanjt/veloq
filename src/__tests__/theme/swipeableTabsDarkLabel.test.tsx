/**
 * Scenario: the active tab label was drawn in the light theme's link teal in
 * both themes, `#00796B` on `#0D0D0F`, 3.65:1, and later in the link colour,
 * which marks a link rather than a selected place.
 *
 * Expected behaviour: the selected label is the primary text and clears 4.5:1
 * on the page, the others are the secondary text, and the indicator is the on
 * role at the tab indicator stroke and holds 3:1 on the page, in both themes.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';

import { SwipeableTabs } from '@/shared/ui';
import { colors, darkColors, stroke } from '@/theme';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const AA_TEXT = 4.5;
const AA_MARK = 3;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TABS = [
  { key: 'one', label: 'One', icon: 'lightbulb-outline' as const },
  { key: 'two', label: 'Two', icon: 'dumbbell' as const },
];

function renderStrip(isDark: boolean) {
  return render(
    <SwipeableTabs tabs={TABS} activeTab="one" onTabChange={jest.fn()} isDark={isDark}>
      {TABS.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
}

async function labelColour(isDark: boolean, key: string, label: string): Promise<string> {
  const { getByTestId } = await renderStrip(isDark);
  return StyleSheet.flatten(within(getByTestId(`tab-${key}`)).getByText(label).props.style)
    .color as string;
}

const THEMES = [
  { name: 'light', isDark: false, palette: colors },
  { name: 'dark', isDark: true, palette: darkColors },
];

describe('the tab strip ink', () => {
  it.each(THEMES)(
    'draws the selected label in the primary text in the $name theme',
    async (theme) => {
      const colour = await labelColour(theme.isDark, 'one', 'One');

      expect(colour).toBe(theme.palette.textPrimary);
      expect(contrastRatio(colour, theme.palette.surfacePage)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  );

  it.each(THEMES)(
    'draws the other labels in the secondary text in the $name theme',
    async (theme) => {
      expect(await labelColour(theme.isDark, 'two', 'Two')).toBe(theme.palette.textSecondary);
    }
  );

  it.each(THEMES)(
    'draws the indicator in the on role at the tab stroke, 3:1 on the page, in the $name theme',
    async (theme) => {
      const { getByTestId } = await renderStrip(theme.isDark);
      const style = StyleSheet.flatten(getByTestId('tab-indicator').props.style);

      expect(style.backgroundColor).toBe(theme.palette.controlOn);
      expect(style.height).toBe(stroke.three);
      expect(
        contrastRatio(style.backgroundColor as string, theme.palette.surfacePage)
      ).toBeGreaterThanOrEqual(AA_MARK);
    }
  );
});
