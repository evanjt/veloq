/**
 * Scenario: the active tab label was drawn in the light theme's link teal in
 * both themes, `#00796B` on `#0D0D0F`, 3.65:1.
 *
 * Expected behaviour: in the dark theme the active label takes the dark link
 * teal and clears 4.5:1 on the dark background.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { SwipeableTabs } from '@/shared/ui';
import { colors, darkColors } from '@/theme';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const AA_TEXT = 4.5;

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

function activeLabelColour(isDark: boolean): string {
  const { getByText } = render(
    <SwipeableTabs tabs={TABS} activeTab="one" onTabChange={jest.fn()} isDark={isDark}>
      {TABS.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
  return StyleSheet.flatten(getByText('One').props.style).color as string;
}

describe('the active tab label', () => {
  it('clears 4.5:1 on the dark background in the dark theme', () => {
    const colour = activeLabelColour(true);

    expect(contrastRatio(colour, darkColors.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the light link teal in the light theme', () => {
    expect(activeLabelColour(false)).toBe(colors.linkTeal);
  });
});
