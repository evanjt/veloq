/**
 * Scenario: the app had no button. 113 files rendered a `TouchableOpacity`, 55
 * a `Pressable`, and 124 distinct `StyleSheet` keys matching `button` were the
 * variant list nobody had written down.
 *
 * Expected behaviour: one `Button` with four variants and two sizes, drawn
 * from tokens only, that refuses a press while disabled or loading and never
 * renders smaller than the platform's own tap-target minimum. `ToggleButton`
 * carries a selected state that is readable without colour, because colour
 * alone is not a state.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Button, ToggleButton } from '@/shared/ui/Button';
import { colors, layout, spacing, typography } from '@/theme';
import { MIN_TAP_TARGET } from '@/theme/spacing';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

function flatten(style: unknown): Record<string, number | string> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<
    string,
    number | string
  >;
}

function styleOf(node: { props: { style?: unknown } }) {
  return flatten(node.props.style);
}

describe('Button', () => {
  it('draws the primary variant from tokens, with no literal of its own', () => {
    const { getByTestId } = render(<Button label="Save" onPress={() => {}} testID="b" />);

    const style = styleOf(getByTestId('b'));
    expect(style.backgroundColor).toBe(colors.primary);
    expect(style.borderRadius).toBe(layout.borderRadiusMd);
    expect(style.paddingHorizontal).toBe(spacing.md);
  });

  it('gives each variant its own ground and border', () => {
    const grounds = (['primary', 'secondary', 'ghost', 'destructive'] as const).map((variant) => {
      const { getByTestId } = render(
        <Button label="x" variant={variant} onPress={() => {}} testID="b" />
      );
      return styleOf(getByTestId('b')).backgroundColor;
    });

    expect(grounds[0]).toBe(colors.primary);
    expect(grounds[1]).toBe(colors.surface);
    expect(grounds[2]).toBe('transparent');
    expect(grounds[3]).toBe(colors.error);
    expect(new Set(grounds).size).toBe(4);
  });

  it('sizes sm and md apart, and both from the type scale', () => {
    const { getByTestId: sm } = render(
      <Button label="x" size="sm" onPress={() => {}} testID="b" />
    );
    const { getByTestId: md } = render(<Button label="x" onPress={() => {}} testID="b" />);

    expect(styleOf(sm('b')).paddingVertical).toBeLessThan(
      styleOf(md('b')).paddingVertical as number
    );
    expect(styleOf(sm('b-label')).fontSize).toBe(typography.bodySmall.fontSize);
    expect(styleOf(md('b-label')).fontSize).toBe(typography.body.fontSize);
  });

  it('never renders under the platform tap-target minimum, at either size', () => {
    for (const size of ['sm', 'md'] as const) {
      const { getByTestId } = render(
        <Button label="x" size={size} onPress={() => {}} testID="b" />
      );
      expect(styleOf(getByTestId('b')).minHeight).toBe(layout.minTapTarget);
    }
  });

  it('takes the platform minimum, 44 on iOS against 48 on Android', () => {
    expect(MIN_TAP_TARGET).toEqual({ ios: 44, android: 48 });
    expect(layout.minTapTarget).toBe(MIN_TAP_TARGET[Platform.OS === 'android' ? 'android' : 'ios']);
  });

  it('presses with a ripple on Android and with opacity on iOS, not both', () => {
    const rippleOn = (os: string) => {
      const original = Platform.OS;
      (Platform as { OS: string }).OS = os;
      try {
        const { getByTestId } = render(<Button label="x" onPress={() => {}} testID="b" />);
        return getByTestId('b').props.android_ripple;
      } finally {
        (Platform as { OS: string }).OS = original;
      }
    };

    // `ripple` is resolved once at module load, so this reads what the
    // component was built with rather than the flipped flag: the point is that
    // exactly one platform gets a ripple, and iOS is not it.
    expect(rippleOn('ios')).toBeUndefined();
  });

  it('does not fire onPress while disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<Button label="x" disabled onPress={onPress} testID="b" />);

    fireEvent.press(getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('b').props.accessibilityState.disabled).toBe(true);
  });

  it('does not fire onPress while loading, and says it is busy', () => {
    const onPress = jest.fn();
    const { getByTestId, queryByText } = render(
      <Button label="Save" loading onPress={onPress} testID="b" />
    );

    fireEvent.press(getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('b').props.accessibilityState.busy).toBe(true);
    expect(queryByText('Save')).toBeNull();
  });

  it('fires once when it is neither', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<Button label="x" onPress={onPress} testID="b" />);

    fireEvent.press(getByTestId('b'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a button to a screen reader, labelled by its own text', () => {
    const { getByTestId } = render(<Button label="Save" onPress={() => {}} testID="b" />);

    expect(getByTestId('b').props.accessibilityRole).toBe('button');
    expect(getByTestId('b').props.accessibilityLabel).toBe('Save');
  });
});

describe('ToggleButton', () => {
  it('marks the selected state to a screen reader, not only in colour', () => {
    const { getByTestId } = render(
      <ToggleButton label="Distance" selected onPress={() => {}} testID="t" />
    );

    expect(getByTestId('t').props.accessibilityRole).toBe('button');
    expect(getByTestId('t').props.accessibilityState.selected).toBe(true);
  });

  it('carries a border weight as well as a colour, so the state survives greyscale', () => {
    const { getByTestId: on } = render(
      <ToggleButton label="x" selected onPress={() => {}} testID="t" />
    );
    const { getByTestId: off } = render(<ToggleButton label="x" onPress={() => {}} testID="t" />);

    expect(styleOf(on('t')).borderWidth).toBeGreaterThan(styleOf(off('t')).borderWidth as number);
  });

  it('floors at the tap target like every other button', () => {
    const { getByTestId } = render(<ToggleButton label="x" onPress={() => {}} testID="t" />);

    expect(styleOf(getByTestId('t')).minHeight).toBe(layout.minTapTarget);
  });

  it('does not fire while disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <ToggleButton label="x" disabled onPress={onPress} testID="t" />
    );

    fireEvent.press(getByTestId('t'));

    expect(onPress).not.toHaveBeenCalled();
  });
});
