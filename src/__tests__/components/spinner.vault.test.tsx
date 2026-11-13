/**
 * Scenario: a wait drawn in the light theme's primary blue in dark mode, and a
 * spinner a screen reader reaches as an unnamed element.
 *
 * Expected behaviour: `Spinner` draws the theme's link colour in each theme,
 * announces what is loading as a busy element, takes a caller's colour for a
 * ground the theme does not describe, and inside a control names nothing of
 * its own.
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render } from '@testing-library/react-native';

import { Spinner } from '@/shared/ui/Spinner';
import { colors, darkColors } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

afterEach(() => {
  mockIsDark = false;
});

describe('Spinner', () => {
  it('draws the light link colour in the light theme', async () => {
    const { UNSAFE_getByType } = await render(<Spinner label="Loading kilns" />);
    expect(UNSAFE_getByType(ActivityIndicator).props.color).toBe(colors.actionLink);
  });

  it('draws the dark link colour in the dark theme', async () => {
    mockIsDark = true;
    const { UNSAFE_getByType } = await render(<Spinner label="Loading kilns" />);
    expect(UNSAFE_getByType(ActivityIndicator).props.color).toBe(darkColors.actionLink);
    expect(darkColors.actionLink).not.toBe(colors.actionLink);
  });

  it('announces its label as a busy element', async () => {
    const { getByLabelText } = await render(<Spinner label="Loading kilns" />);
    const node = getByLabelText('Loading kilns');
    expect(node.props.accessible).toBe(true);
    expect(node.props.accessibilityState).toEqual({ busy: true });
  });

  it('reads as a progress bar once it carries how far the wait has got', async () => {
    const { getByRole } = await render(
      <Spinner label="Firing kilns" progress={{ min: 0, max: 12, now: 5 }} />
    );
    expect(getByRole('progressbar', { name: 'Firing kilns' }).props.accessibilityValue).toEqual({
      min: 0,
      max: 12,
      now: 5,
    });
  });

  it('reads as a progress bar with no value before a count is known', async () => {
    const { getByRole } = await render(<Spinner label="Firing kilns" progress />);
    expect(getByRole('progressbar', { name: 'Firing kilns' }).props.accessibilityValue).toBe(
      undefined
    );
  });

  it('draws a colour passed for its ground in either theme', async () => {
    mockIsDark = true;
    const { UNSAFE_getByType } = await render(
      <Spinner label="Loading the glaze map" color="#123456" />
    );
    expect(UNSAFE_getByType(ActivityIndicator).props.color).toBe('#123456');
  });

  it('names nothing of its own inside a control', async () => {
    const { UNSAFE_getByType } = await render(<Spinner inControl color="#ffffff" />);
    const node = UNSAFE_getByType(ActivityIndicator);
    expect(node.props.accessibilityLabel).toBeUndefined();
    expect(node.props.accessible).toBe(false);
  });
});
