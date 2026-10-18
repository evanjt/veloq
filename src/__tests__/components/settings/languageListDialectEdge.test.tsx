/**
 * Scenario: the language list marks regional dialects (CH, AU) apart from plain variants, and the
 * login picker's button marks a chosen dialect. Gold is reserved for achievements.
 * Expected behaviour: in both themes the mark is the neutral control outline rather than any gold,
 * the key below the list shows that same outline, and a selected dialect is the plain selected
 * chip's fill at the plain chip's weight, so selection never rests on a heavier coloured edge.
 */

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { LanguagePicker } from '@/features/auth/components/LanguagePicker';
import { useLanguageStore } from '@/shared/app/LanguageStore';
import { flattenStyle } from '@/shared/ui/flattenStyle';
import { LanguageList } from '@/shared/ui/LanguageList';
import { brand, colors, controlHeight, darkColors, layout } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));

const GOLDS = Object.entries(brand)
  .filter(([name]) => name.toLowerCase().includes('gold'))
  .map(([, value]) => String(value).toUpperCase());

function styleOf(node: { props: { style?: StyleProp<ViewStyle> } }): ViewStyle {
  return flattenStyle<ViewStyle>(node.props.style);
}

function expectNoGold(style: { borderColor?: unknown; backgroundColor?: unknown }) {
  expect(GOLDS).not.toContain(String(style.borderColor).toUpperCase());
  expect(GOLDS).not.toContain(String(style.backgroundColor).toUpperCase());
}

describe.each([
  ['light', false],
  ['dark', true],
] as const)('dialect mark in the %s theme', (_mode, isDark) => {
  const palette = isDark ? darkColors : colors;

  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('outlines an unselected dialect chip with the control outline, not gold', async () => {
    const screen = await render(<LanguageList language="de-DE" onSelect={jest.fn()} />);
    const dialect = styleOf(screen.getByLabelText('CH, settings.dialect'));
    const plain = styleOf(screen.getByLabelText('GB'));
    expectNoGold(dialect);
    expect(dialect.borderColor).toBe(palette.controlBoundary);
    expect(dialect.borderWidth).toBe(plain.borderWidth);
    expect(dialect.backgroundColor).toBe(plain.backgroundColor);
  });

  it('draws a selected dialect as the plain selected chip', async () => {
    const screen = await render(<LanguageList language="en-AU" onSelect={jest.fn()} />);
    const selectedDialect = styleOf(screen.getByLabelText('AU, settings.dialect'));
    const unselectedPlain = styleOf(screen.getByLabelText('GB'));
    expectNoGold(selectedDialect);
    expect(selectedDialect.backgroundColor).toBe(palette.controlOn);
    expect(selectedDialect.borderColor).toBe(palette.focusRing);
    expect(selectedDialect.borderWidth).toBe(unselectedPlain.borderWidth);
  });

  it('keeps the key under the list, its swatch drawn with the same outline', async () => {
    const screen = await render(<LanguageList language="de-DE" onSelect={jest.fn()} />);
    expect(screen.getByText('settings.dialect', { includeHiddenElements: true })).toBeTruthy();
    const swatch = screen.getByTestId('language-dialect-key-swatch', {
      includeHiddenElements: true,
    });
    const swatchStyle = styleOf(swatch);
    expectNoGold(swatchStyle);
    expect(swatchStyle.borderColor).toBe(palette.controlBoundary);
  });

  it('marks the login button for a chosen dialect without gold', async () => {
    await act(async () => {
      useLanguageStore.setState({ language: 'en-AU' });
    });
    const screen = await render(<LanguagePicker />);
    const button = styleOf(screen.getByTestId('login-language-button'));
    expectNoGold(button);
    expect(button.borderColor).toBe(palette.controlBoundary);
    await fireEvent.press(screen.getByTestId('login-language-button'));
    expect(screen.getByLabelText('AU, settings.dialect')).toBeTruthy();
  });
});

describe('variant chips', () => {
  const haptics = jest.requireMock('@/shared/ui/haptics') as Record<string, jest.Mock>;

  beforeEach(() => {
    mockIsDark = false;
    jest.clearAllMocks();
  });

  it('draws a variant as the shared selector chip', async () => {
    const screen = await render(<LanguageList language="de-DE" onSelect={jest.fn()} />);
    const plain = styleOf(screen.getByLabelText('GB'));
    expect(plain.borderRadius).toBe(layout.borderRadiusFull);
    expect(plain.minHeight).toBe(controlHeight.chip);
  });

  it('ticks once when a press chooses a variant, and not on the chosen one', async () => {
    const onSelect = jest.fn();
    const screen = await render(<LanguageList language="en-GB" onSelect={onSelect} />);
    await fireEvent.press(screen.getByLabelText('GB'));
    expect(haptics.selection).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('AU, settings.dialect'));
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('en-AU');
  });
});
