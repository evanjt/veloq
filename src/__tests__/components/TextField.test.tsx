/**
 * Scenario: every form drew its own input, most labelled by placeholder alone,
 * so a filled field said nothing about what it held, a decimal pad on iOS had
 * no way to finish, and the dark theme raised the light keyboard.
 *
 * Expected behaviour: the shared field is named by its label on both
 * platforms whatever it holds, a numeric pad finishes with Done unless the
 * caller says otherwise, the keyboard follows the theme, a unit is part of the
 * name, an error is shown, announced and replaces the supporting text, and a
 * secret can be shown to check a paste and hidden again.
 */
import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { TextField } from '@/shared/ui/TextField';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let mockIsDark = false;
jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

const originalOS = Platform.OS;

function liveRegionOf(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
  }
  return undefined;
}

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  mockIsDark = false;
  setOS(originalOS);
  jest.restoreAllMocks();
});

describe.each(['ios', 'android'] as const)('TextField on %s', (os) => {
  beforeEach(() => setOS(os));

  it('is named by its label while it holds a value', async () => {
    const { getByLabelText } = await render(
      <TextField label="Harbour" value="Port Lumen" onChangeText={() => {}} testID="field" />
    );
    const input = getByLabelText('Harbour');
    expect(input.props.value).toBe('Port Lumen');
    expect(input.props.testID).toBe('field');
  });

  it('shows its label as text, not only as a placeholder', async () => {
    const { getAllByText } = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} />
    );
    // On iOS the visible label is hidden from the screen reader, which reads it
    // as the field's name instead.
    expect(getAllByText('Harbour', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  it('finishes a decimal pad with Done unless the caller sets a return key', async () => {
    const pad = await render(
      <TextField
        label="Tide"
        value="1.5"
        onChangeText={() => {}}
        keyboardType="decimal-pad"
        testID="pad"
      />
    );
    expect(pad.getByTestId('pad').props.returnKeyType).toBe('done');
    await pad.unmount();

    const next = await render(
      <TextField
        label="Tide"
        value="1.5"
        onChangeText={() => {}}
        keyboardType="number-pad"
        returnKeyType="next"
        testID="pad"
      />
    );
    expect(next.getByTestId('pad').props.returnKeyType).toBe('next');
    await next.unmount();

    const text = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="text" />
    );
    expect(text.getByTestId('text').props.returnKeyType).toBeUndefined();
  });

  it('raises the keyboard in the theme it is drawn in', async () => {
    const light = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    expect(light.getByTestId('f').props.keyboardAppearance).toBe('light');
    await light.unmount();

    mockIsDark = true;
    const dark = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    expect(dark.getByTestId('f').props.keyboardAppearance).toBe('dark');
  });

  it('carries its unit beside the value and in its name', async () => {
    const { getByLabelText, getAllByText } = await render(
      <TextField label="Depth" unit="fathoms" value="12" onChangeText={() => {}} />
    );
    expect(getByLabelText('Depth, fathoms').props.value).toBe('12');
    expect(getAllByText('fathoms', { includeHiddenElements: true }).length).toBeGreaterThan(0);
  });

  it('replaces the supporting text with the error and announces it', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const { getByTestId, queryByText, rerender } = await render(
      <TextField
        label="Tide"
        value="1"
        onChangeText={() => {}}
        hint="Between 1 and 9"
        testID="tide"
      />
    );
    expect(queryByText('Between 1 and 9')).toBeTruthy();
    expect(() => getByTestId('tide-error')).toThrow();

    await rerender(
      <TextField
        label="Tide"
        value="0"
        onChangeText={() => {}}
        hint="Between 1 and 9"
        error="Enter a tide above zero"
        testID="tide"
      />
    );
    const error = getByTestId('tide-error');
    expect(error.props.children).toBe('Enter a tide above zero');
    expect(liveRegionOf(error)).toBe('polite');
    expect(queryByText('Between 1 and 9')).toBeNull();
    expect(getByTestId('tide').props.accessibilityHint).toBe('Enter a tide above zero');
    if (os === 'ios') {
      expect(announce).toHaveBeenCalledWith('Enter a tide above zero');
    }
  });

  it('shows a secret on request and hides it again', async () => {
    const { getByTestId } = await render(
      <TextField
        label="Lockbox"
        value="gull-pier-kelp"
        onChangeText={() => {}}
        secureTextEntry
        testID="lockbox"
      />
    );
    expect(getByTestId('lockbox').props.secureTextEntry).toBe(true);

    const toggle = getByTestId('lockbox-reveal');
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('common.showPassword');
    expect(toggle.props.accessibilityState).toMatchObject({ selected: false });

    await fireEvent.press(toggle);
    expect(getByTestId('lockbox').props.secureTextEntry).toBe(false);
    const shown = getByTestId('lockbox-reveal');
    expect(shown.props.accessibilityLabel).toBe('common.hidePassword');
    expect(shown.props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(shown);
    expect(getByTestId('lockbox').props.secureTextEntry).toBe(true);
  });

  it('draws no reveal control on a field that is not secret', async () => {
    const { queryByTestId } = await render(
      <TextField label="Harbour" value="Port Lumen" onChangeText={() => {}} testID="harbour" />
    );
    expect(queryByTestId('harbour-reveal')).toBeNull();
  });

  it('leaves the text size uncapped', async () => {
    const { getByTestId } = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    // Zero is React Native's own "no cap", which Paper's 1.5 default needs.
    expect([undefined, 0]).toContain(getByTestId('f').props.maxFontSizeMultiplier);
  });
});

describe('TextField on ios', () => {
  beforeEach(() => setOS('ios'));

  // Android's outlined field sizes its input from the label it measures, so
  // the fixed height that clipped scaled text is an iOS-path concern.
  it('never fixes its height, so scaled text grows the field', async () => {
    const { getByTestId } = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    const flat = [getByTestId('f').props.style].flat(Infinity).filter(Boolean);
    expect(flat.some((style: { height?: number }) => style.height !== undefined)).toBe(false);
  });
});
