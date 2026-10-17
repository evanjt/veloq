/**
 * Scenario: a screen waits on data behind skeletons, in either theme.
 * Expected behaviour: the pulse runs between two colours that differ, so the
 * wait visibly moves, and the loading region says it is loading once rather
 * than again on every pulse.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { ChartSkeleton, Shimmer, shimmerColours } from '@/shared/ui/Shimmer';
import { contrastRatio } from '../__shared__/contrast';

const mockTheme = { isDark: false };
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => mockTheme }));

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
])('an animated shimmer in %s draws a highlight unlike its base', async (_theme, isDark) => {
  mockTheme.isDark = isDark;
  await render(<Shimmer animated />);

  const root = screen.toJSON() as ReactTestRendererJSON;
  const highlight = root.children?.[0] as ReactTestRendererJSON | undefined;
  expect(highlight).toBeDefined();
  const baseColour = StyleSheet.flatten(root.props.style).backgroundColor;
  const highlightColour = StyleSheet.flatten(highlight?.props.style).backgroundColor;

  expect(baseColour).toBe(shimmerColours(isDark).base);
  expect(highlightColour).toBe(shimmerColours(isDark).highlight);
  expect(highlightColour).not.toBe(baseColour);
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
