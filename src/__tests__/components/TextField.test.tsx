/**
 * Scenario: every form drew its own input, most labelled by placeholder alone,
 * so a filled field said nothing about what it held, a decimal pad on iOS had
 * no way to finish, and the dark theme raised the light keyboard.
 *
 * Expected behaviour: the shared field is named by its label on both
 * platforms whatever it holds, a numeric pad finishes with Done unless the
 * caller says otherwise, the keyboard follows the theme, a unit is part of the
 * name, an error is shown, announced and replaces the supporting text, and a
 * secret can be shown to check a paste and hidden again. The edge follows the
 * field's state, a focused field draws a 2 pt focus ring without changing its
 * size, the placeholder is tertiary text, and Android's outlined field takes
 * the same radius, edge and text style as iOS.
 */
import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { colors, layout, stroke, typography } from '@/theme';
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

type Flat = Record<string, number | string | undefined>;

function flat(node: ReactTestInstance): Flat {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Flat;
}

function hostParent(node: ReactTestInstance): ReactTestInstance {
  let at = node.parent;
  while (at && typeof at.type !== 'string') at = at.parent;
  if (!at) throw new Error('no host parent');
  return at;
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

describe.each(['ios', 'android'] as const)('TextField placeholder on %s', (os) => {
  beforeEach(() => setOS(os));

  // Android's outlined field shows the placeholder only once focus has lifted the label.
  it('draws the placeholder in tertiary text', async () => {
    const { getByTestId } = await render(
      <TextField
        label="Harbour"
        value=""
        placeholder="Port Lumen"
        onChangeText={() => {}}
        testID="f"
      />
    );
    await fireEvent(getByTestId('f'), 'focus');
    await waitFor(() =>
      expect(getByTestId('f').props.placeholderTextColor).toBe(colors.textTertiary)
    );
  });
});

describe('TextField edge on ios', () => {
  beforeEach(() => setOS('ios'));

  it('turns the edge to a 2 pt focus ring on focus without changing the field size', async () => {
    const { getByTestId } = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    const input = getByTestId('f');
    const box = hostParent(input);
    const idleBox = flat(box);
    const idleInput = flat(input);
    expect(idleBox.borderColor).toBe(colors.controlBoundary);
    expect(idleBox.borderWidth).toBe(stroke.one);

    await fireEvent(input, 'focus');
    const focusedBox = flat(box);
    const focusedInput = flat(input);
    expect(focusedBox.borderColor).toBe(colors.focusRing);
    expect(focusedBox.borderWidth).toBe(stroke.two);
    // The extra point is taken from the padding inside the edge, so the row keeps its size.
    expect(Number(focusedBox.borderWidth) + Number(focusedBox.paddingHorizontal)).toBe(
      Number(idleBox.borderWidth) + Number(idleBox.paddingHorizontal)
    );
    expect(Number(focusedBox.borderWidth) + Number(focusedInput.paddingVertical)).toBe(
      Number(idleBox.borderWidth) + Number(idleInput.paddingVertical)
    );
    expect(focusedBox.minHeight).toBe(idleBox.minHeight);

    await fireEvent(input, 'blur');
    expect(flat(box).borderColor).toBe(colors.controlBoundary);
  });

  it('keeps the error edge at 1 pt while focused', async () => {
    const { getByTestId } = await render(
      <TextField label="Harbour" value="" error="Too far" onChangeText={() => {}} testID="f" />
    );
    const input = getByTestId('f');
    await fireEvent(input, 'focus');
    expect(flat(hostParent(input)).borderColor).toBe(colors.errorText);
    expect(flat(hostParent(input)).borderWidth).toBe(stroke.one);
  });
});

describe('TextField edge on android', () => {
  beforeEach(() => setOS('android'));

  it('draws the outline at the shared radius, edged by the field state', async () => {
    const view = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    const outline = () => flat(view.getByTestId('text-input-outline'));
    expect(outline().borderRadius).toBe(layout.borderRadiusSm);
    expect(outline().borderColor).toBe(colors.controlBoundary);
    expect(outline().borderWidth).toBe(stroke.one);

    await fireEvent(view.getByTestId('f'), 'focus');
    expect(outline().borderColor).toBe(colors.focusRing);
    expect(outline().borderWidth).toBe(stroke.two);
  });

  it('edges a refused field in the error colour at 1 pt', async () => {
    const view = await render(
      <TextField label="Harbour" value="" error="Too far" onChangeText={() => {}} testID="f" />
    );
    await fireEvent(view.getByTestId('f'), 'focus');
    const outline = flat(view.getByTestId('text-input-outline'));
    expect(outline.borderColor).toBe(colors.errorText);
    expect(outline.borderWidth).toBe(stroke.one);
  });

  it('sets the input in the body text style', async () => {
    const { getByTestId } = await render(
      <TextField label="Harbour" value="" onChangeText={() => {}} testID="f" />
    );
    const input = flat(getByTestId('f'));
    expect(input.fontFamily).toBe(typography.body.fontFamily);
    expect(input.fontSize).toBe(typography.body.fontSize);
  });
});
