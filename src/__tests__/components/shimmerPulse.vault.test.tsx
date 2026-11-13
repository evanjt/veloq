/**
 * Scenario: a screen waits on data behind skeletons, in either theme.
 * Expected behaviour: each block's own colour pulses between two colours that
 * differ, so the wait visibly moves, it holds still with reduce motion on, and
 * the loading region says it is loading once rather than again on every pulse.
 */

import React from 'react';
import { processColor } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { duration } from '@/theme';
import { ChartSkeleton, Shimmer, shimmerColours } from '@/shared/ui/Shimmer';
import { contrastRatio } from '../__shared__/contrast';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';

const mockTheme = { isDark: false };
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));
let mockReduceMotion = false;
jest.mock('@/shared/ui/reduceMotion', () => ({
  ...jest.requireActual('@/shared/ui/reduceMotion'),
  useReduceMotion: () => mockReduceMotion,
  isReduceMotionOn: () => mockReduceMotion,
}));

/** The block's drawn colour, in one form whichever way the style carries it. */
function drawnColour(): unknown {
  const colour = getAnimatedStyle(screen.getByTestId('pulse-block')).backgroundColor;
  return typeof colour === 'number' ? colour : processColor(colour as string);
}

beforeEach(() => {
  mockReduceMotion = false;
  mockTheme.isDark = false;
});

// A floor rather than the guide's own 1.34:1 and 1.30:1, so a later token merge
// that folds the two colours into one fails here.
const PULSE_FLOOR = 1.2;

it.each([
  ['light', false],
  ['dark', true],
])('the %s pulse runs between two colours that differ', (_theme, isDark) => {
  const { base, highlight } = shimmerColours(isDark);

  expect(contrastRatio(base, highlight)).toBeGreaterThanOrEqual(PULSE_FLOOR);
});

it.each([
  ['light', false],
  ['dark', true],
])(
  'an animated block in %s pulses its own colour to the highlight and back',
  async (_t, isDark) => {
    jest.useFakeTimers();
    try {
      mockTheme.isDark = isDark;
      await render(<Shimmer animated testID="pulse-block" />);
      const { base, highlight } = shimmerColours(isDark);

      expect(drawnColour()).toBe(processColor(base));
      await act(() => advanceAnimationByTime(duration.pulse));
      expect(drawnColour()).toBe(processColor(highlight));
      await act(() => advanceAnimationByTime(duration.pulse));
      expect(drawnColour()).toBe(processColor(base));
      expect(screen.toJSON()).not.toHaveProperty('children.0');
    } finally {
      jest.useRealTimers();
    }
  }
);

it('holds the base colour with reduce motion on', async () => {
  jest.useFakeTimers();
  try {
    mockReduceMotion = true;
    await render(<Shimmer animated testID="pulse-block" />);

    await act(() => advanceAnimationByTime(duration.pulse / 2));
    expect(drawnColour()).toBe(processColor(shimmerColours(false).base));
    await act(() => advanceAnimationByTime(duration.pulse));
    expect(drawnColour()).toBe(processColor(shimmerColours(false).base));
  } finally {
    jest.useRealTimers();
  }
});

it('keeps the loading label still across pulses', async () => {
  jest.useFakeTimers();
  try {
    await render(<ChartSkeleton />);
    const before = screen.getByRole('progressbar').props.accessibilityLabel;

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe(before);
  } finally {
    jest.useRealTimers();
  }
});
