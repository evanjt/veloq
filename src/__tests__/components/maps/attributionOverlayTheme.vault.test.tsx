import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { AttributionOverlay } from '@/features/maps/components/AttributionOverlay';
import { colors, darkColors } from '@/theme';

const mockTheme = { isDark: false };
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));

const barOf = (screen: Awaited<ReturnType<typeof render>>) =>
  StyleSheet.flatten(screen.getByTestId('map-attribution-bar').props.style);
const textOf = (screen: Awaited<ReturnType<typeof render>>) =>
  StyleSheet.flatten(screen.getByTestId('map-attribution-text').props.style);

describe('AttributionOverlay follows the app theme', () => {
  afterEach(() => {
    mockTheme.isDark = false;
  });

  it('draws no white bar and uses the dark text colour in a dark theme', async () => {
    mockTheme.isDark = true;
    const screen = await render(<AttributionOverlay initialAttribution="© Credit" />);
    expect(barOf(screen).backgroundColor).not.toMatch(/255,\s*255,\s*255|#fff/i);
    expect(textOf(screen).color).toBe(darkColors.textSecondary);
  });

  it('keeps the light bar in a light theme', async () => {
    const screen = await render(<AttributionOverlay initialAttribution="© Credit" />);
    expect(barOf(screen).backgroundColor).toMatch(/255,\s*255,\s*255/);
    expect(textOf(screen).color).toBe(colors.textSecondary);
  });
});
