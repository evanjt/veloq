/**
 * Scenario: the demo banner and the offline banner are read at a glance, and
 * both drew white on a mid-tone fill. Neither is an inactive control, so no
 * WCAG exemption reaches them.
 *
 * Expected behaviour: every word in either banner clears 4.5:1 against the
 * fill it is drawn on, in both schemes. Measured from what the components
 * actually render, so a palette edit that undoes it fails here.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DemoBanner } from '@/shared/app/DemoBanner';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';

/** WCAG 2.2 AA for body text. */
const AA_TEXT = 4.5;

let mockIsDark = false;

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('@/shared/app/NetworkContext', () => ({ useNetwork: () => ({ isOnline: false }) }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      isDemoMode: true,
      hideDemoBanner: false,
      exitDemoMode: () => {},
    }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ reset: () => {} }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@/shared/storage', () => ({ clearDemoData: () => {} }));

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parse(colour: string): [number, number, number, number] {
  const rgba = colour.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => Number(p.trim()));
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    1,
  ];
}

/** The ink as it lands, with any alpha composited onto the fill behind it. */
function composite(ink: string, fill: string): [number, number, number] {
  const [r, g, b, a] = parse(ink);
  const [fr, fg, fb] = parse(fill);
  return [r * a + fr * (1 - a), g * a + fg * (1 - a), b * a + fb * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(ink: string, fill: string): number {
  const a = luminance(composite(ink, fill));
  const [fr, fg, fb] = parse(fill);
  const b = luminance([fr, fg, fb]);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every colour the flattened style of each rendered `Text` draws in. */
function inks(testID: string): { fill: string; inks: string[] } {
  const banner = screen.getByTestId(testID);
  const fill = StyleSheet.flatten(banner.props.style)?.backgroundColor as string;
  const texts = screen.UNSAFE_getAllByType(
    require('react-native-paper').Text as React.ComponentType
  );
  return {
    fill,
    inks: texts
      .map((node) => StyleSheet.flatten(node.props.style)?.color as string)
      .filter(Boolean),
  };
}

describe('a banner read at a glance clears the text bar', () => {
  afterEach(() => {
    mockIsDark = false;
  });

  it('draws every demo-banner word over its light fill at 4.5:1', () => {
    render(<DemoBanner />);
    const { fill, inks: colours } = inks('demo-mode-banner');

    expect(colours.length).toBeGreaterThan(1);
    for (const ink of colours) {
      expect(ratio(ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('draws every demo-banner word over its dark fill at 4.5:1', () => {
    mockIsDark = true;
    render(<DemoBanner />);
    const { fill, inks: colours } = inks('demo-mode-banner');

    expect(colours.length).toBeGreaterThan(1);
    for (const ink of colours) {
      expect(ratio(ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('draws every offline-banner word over its fill at 4.5:1', () => {
    render(<OfflineBanner />);
    const { fill, inks: colours } = inks('offline-banner');

    expect(colours.length).toBeGreaterThan(1);
    for (const ink of colours) {
      expect(ratio(ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
