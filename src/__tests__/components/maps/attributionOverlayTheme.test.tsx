import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { AttributionOverlay } from '@/features/maps/components/AttributionOverlay';
import { colors, darkColors } from '@/theme';

const pillOf = (screen: ReturnType<typeof render>) =>
  StyleSheet.flatten(screen.getByTestId('map-attribution-pill').props.style);
const textOf = (screen: ReturnType<typeof render>) =>
  StyleSheet.flatten(screen.getByTestId('map-attribution-text').props.style);

describe('AttributionOverlay on a dark basemap', () => {
  it('draws no white pill and uses the dark text colour', () => {
    const screen = render(<AttributionOverlay initialAttribution="© Credit" isDark />);
    expect(pillOf(screen).backgroundColor).not.toMatch(/255,\s*255,\s*255|#fff/i);
    expect(textOf(screen).color).toBe(darkColors.textSecondary);
  });

  it('keeps the light pill on a light basemap', () => {
    const screen = render(<AttributionOverlay initialAttribution="© Credit" />);
    expect(pillOf(screen).backgroundColor).toMatch(/255,\s*255,\s*255/);
    expect(textOf(screen).color).toBe(colors.textSecondary);
  });
});
