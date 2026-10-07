/**
 * Scenario: the signal status line drew its icon and label in the raw fill
 * palette (`success` 2.28:1, `warning` 2.15:1, `error` 3.38:1 on white), and
 * the engine banner drew its alert icon in a tone chosen for a light ground on
 * a banner that is always dark amber (2.11:1).
 *
 * Expected behaviour: every signal level's mark clears the bar on the surface
 * it sits on in both themes, the banner's alert icon clears 3:1 on the banner
 * ground, and the widget's upward trend is the positive rung of the ladder.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  SIGNAL_TINT_ALPHA,
  signalColor,
  signalTint,
  type SignalLevel,
} from '@/shared/ui/SignalStatus';
import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { widgetPalette } from '@/shared/theme/widgetTheme';
import { colors, darkColors, verdictColor } from '@/theme';

function luminance(hex: string): number {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `bg`, as the 10% tint the status line sits on. */
function over(fg: string, alpha: number, bg: string): string {
  const mixed = [1, 3, 5].map((i) => {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const b = parseInt(bg.slice(i, i + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockStatus = { initFailed: true, initFailureReason: null, requestRetry: jest.fn() };
jest.mock('@/features/routes/stores/EngineStatusStore', () => ({
  useEngineStatus: (select: (s: typeof mockStatus) => unknown) => select(mockStatus),
}));

const LEVELS: SignalLevel[] = ['ok', 'warn', 'bad'];

describe.each([
  ['light', false, colors.background],
  ['dark', true, darkColors.surfaceCard],
] as const)('signalColor in the %s theme', (_name, isDark, surface) => {
  it.each(LEVELS)('keeps %s at 4.5:1 on the chip tint over the surface', (level) => {
    const tone = signalColor(level, isDark);
    expect(
      contrast(tone, over(signalTint(level, isDark), SIGNAL_TINT_ALPHA, surface))
    ).toBeGreaterThanOrEqual(4.5);
  });
});

it('draws the engine banner alert icon at 3:1 on the banner ground', () => {
  const { UNSAFE_getByProps } = render(<EngineInitBanner />);
  const icon = UNSAFE_getByProps({ name: 'alert-circle-outline' });
  const color = StyleSheet.flatten(icon.props.style)?.color ?? icon.props.color;

  expect(contrast(color, colors.warningBannerBg)).toBeGreaterThanOrEqual(3);
});

it('draws the widget upward trend from the positive rung in both themes', () => {
  expect(widgetPalette.light.trendUp).toBe(verdictColor('positive', false));
  expect(widgetPalette.dark.trendUp).toBe(verdictColor('positive', true));
});
