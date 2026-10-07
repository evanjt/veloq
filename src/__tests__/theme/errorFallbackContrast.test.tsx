import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { ChartErrorBoundary } from '@/shared/ui/ChartErrorBoundary';
import { ComponentErrorBoundary } from '@/shared/ui/ComponentErrorBoundary';
import { darkColors } from '@/theme';

let mockIsDark = false;

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));

function Crash(): React.ReactElement {
  throw new Error('render failed');
}

function fallbackColours(): { ground: string; text: string[] } {
  const fallback = screen
    .UNSAFE_getAllByType(View)
    .find((view) => StyleSheet.flatten(view.props.style)?.borderWidth === 1);
  const ground = StyleSheet.flatten(fallback?.props.style)?.backgroundColor as string;
  const text = screen
    .UNSAFE_getAllByType(Text)
    .map((node) => StyleSheet.flatten(node.props.style)?.color as string)
    .filter(Boolean);
  return { ground, text };
}

describe('error fallback colours', () => {
  beforeEach(() => {
    mockIsDark = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockIsDark = false;
  });

  it.each([
    ['component', ComponentErrorBoundary],
    ['chart', ChartErrorBoundary],
  ])('draws the %s fallback on a dark ground under dark text', (_name, Boundary) => {
    render(
      <Boundary>
        <Crash />
      </Boundary>
    );
    const { ground, text } = fallbackColours();

    expect(ground).toBe(darkColors.background);
    expect(text).toContain(darkColors.textSecondary);
  });
});
