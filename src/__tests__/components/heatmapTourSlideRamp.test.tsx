/**
 * Scenario: the App Tour's heatmap slide pictures the activity calendar above
 * an HRV and a resting heart rate line, and is shown in either theme.
 *
 * Expected behaviour: its cells come from the calendar's own ramp, the neutral
 * fill for a day with nothing and the sequential steps above it, and its two
 * lines and their key dots take the active theme's series colours, so the dark
 * tour mirrors the dark screen. No value beside a line is set in the line's
 * colour.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { HeatmapSlide } from '@/features/settings/components/whatsNew/HeatmapSlide';
import { colors, contributionRamp, darkColors } from '@/theme';

let mockDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

/** The colour each Skia element of one kind is drawn in, in drawing order. */
function drawnColours(kind: 'Path' | 'RoundedRect'): string[] {
  return screen.UNSAFE_root.findAll(
    (node) => (node.type as { displayName?: string }).displayName === kind
  ).map((node) => node.props.color as string);
}

function textColours(): string[] {
  return screen.root
    .findAllByType('Text' as never)
    .map((node) => StyleSheet.flatten((node.props as { style?: unknown }).style as never))
    .map((style) => (style as { color?: string } | undefined)?.color)
    .filter((colour): colour is string => typeof colour === 'string');
}

describe.each([
  ['light', false],
  ['dark', true],
] as const)('the heatmap tour slide in %s', (theme, isDark) => {
  const palette = isDark ? darkColors : colors;
  const other = isDark ? colors : darkColors;

  beforeEach(() => {
    mockDark = isDark;
  });

  it("draws its cells from the calendar's ramp for this theme", async () => {
    await render(<HeatmapSlide />);
    const ramp: readonly string[] = contributionRamp[theme];

    const cells = drawnColours('RoundedRect').filter((c) => c !== 'transparent');
    const shaded = cells.filter((c) => ramp.includes(c));

    expect(shaded).toContain(ramp[0]);
    for (const level of [1, 2, 3, 4]) expect(shaded).toContain(ramp[level]);
  });

  it("draws the HRV and resting heart rate lines in this theme's series colours", async () => {
    await render(<HeatmapSlide />);

    const lines = drawnColours('Path');
    expect(lines).toEqual([palette.chartHrv, palette.chartRhr]);
    if (palette.chartHrv !== other.chartHrv) expect(lines).not.toContain(other.chartHrv);
    if (palette.chartRhr !== other.chartRhr) expect(lines).not.toContain(other.chartRhr);
  });

  it('sets no value in the colour of the line it keys', async () => {
    await render(<HeatmapSlide />);

    const text = textColours();
    expect(text).not.toContain(palette.chartHrv);
    expect(text).not.toContain(palette.chartRhr);
  });
});
