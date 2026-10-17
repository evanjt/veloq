/**
 * Scenario: the app had no button. 113 files rendered a `TouchableOpacity`, 55
 * a `Pressable`, and 124 distinct `StyleSheet` keys matching `button` were the
 * variant list nobody had written down.
 *
 * Expected behaviour: one `Button` with four variants and two sizes, drawn
 * from tokens only, that refuses a press while disabled or loading and whose
 * drawn height plus hit slop reaches the platform's own tap-target minimum.
 * `ToggleButton` carries a selected state that is readable without colour,
 * because colour alone is not a state.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { Button, ToggleButton, ToggleButtonRow, paint } from '@/shared/ui/Button';
import { colors, darkColors, iconSize, layout, spacing, stroke, typography } from '@/theme';
import { MIN_TAP_TARGET } from '@/theme/spacing';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

let mockButtonShapes = false;
jest.mock('@/shared/ui/buttonShapes', () => ({
  useButtonShapes: () => mockButtonShapes,
}));

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('label contrast', () => {
  afterEach(() => {
    mockIsDark = false;
  });

  for (const isDark of [false, true]) {
    const theme = isDark ? 'dark' : 'light';
    it(`keeps every variant's label at 4.5:1 in the ${theme} theme, a transparent one on each ground it sits on`, async () => {
      mockIsDark = isDark;
      const palette = isDark ? darkColors : colors;
      const pageGrounds = [palette.surface, palette.background, palette.backgroundAlt];
      for (const variant of ['primary', 'secondary', 'ghost', 'destructive'] as const) {
        const { getByTestId } = await render(
          <Button label="x" variant={variant} onPress={() => {}} testID="b" />
        );
        const ground = styleOf(getByTestId('b')).backgroundColor as string;
        const ink = styleOf(getByTestId('b-label')).color as string;
        for (const under of ground === 'transparent' ? pageGrounds : [ground]) {
          expect(contrastRatio(ink, under)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`keeps a selected ToggleButton label at 4.5:1 in the ${theme} theme`, async () => {
      mockIsDark = isDark;
      const { getByTestId } = await render(
        <ToggleButton label="x" selected onPress={() => {}} testID="t" />
      );
      const ground = styleOf(getByTestId('t')).backgroundColor as string;
      const ink = styleOf(getByTestId('t-label')).color as string;
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(4.5);
    });

    // The chip draws on whatever surface holds it, and an unselected chip's
    // ground is a wash laid over that surface, so each surface is a ground.
    const surfaces = isDark
      ? [
          darkColors.background,
          darkColors.surface,
          darkColors.surfaceElevated,
          darkColors.surfaceCard,
        ]
      : [colors.surface, colors.background, colors.backgroundAlt];

    for (const selected of [false, true]) {
      const state = selected ? 'selected' : 'unselected';
      it(`keeps a ToggleButton's label and count at 4.5:1 when ${state}, in the ${theme} theme`, async () => {
        mockIsDark = isDark;
        const { getByTestId } = await render(
          <ToggleButton label="x" count={12} selected={selected} onPress={() => {}} testID="t" />
        );
        const fill = styleOf(getByTestId('t')).backgroundColor as string;

        const failing = surfaces.flatMap((surface) => {
          const ground = over(fill, surface);
          return (['t-label', 't-count'] as const).flatMap((id) => {
            const ratio = contrastRatio(
              over(styleOf(getByTestId(id)).color as string, ground),
              ground
            );
            return ratio >= 4.5 ? [] : [`${id} on ${surface} ${ratio.toFixed(2)}`];
          });
        });

        expect(failing).toStrictEqual([]);
      });
    }
  }
});

function flatten(style: unknown): Record<string, number | string> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<
    string,
    number | string
  >;
}

function styleOf(node: { props: { style?: unknown } }) {
  return flatten(node.props.style);
}

function reachHeight(node: {
  props: { style?: unknown; hitSlop?: { top?: number; bottom?: number } };
}): number {
  const { hitSlop } = node.props;
  return Number(styleOf(node).minHeight ?? 0) + (hitSlop?.top ?? 0) + (hitSlop?.bottom ?? 0);
}

/** A colour, `#rrggbb` or `rgba(...)`, laid over an opaque `#rrggbb` ground. */
function over(color: string, ground: string): string {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  if (!rgba) return color;
  const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
  const base = hex(ground);
  return (
    '#' +
    [r, g, b]
      .map((c, i) => Math.round(c * a + base[i] * (1 - a)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

describe('Button', () => {
  it('draws the primary variant from tokens, with no literal of its own', async () => {
    const { getByTestId } = await render(<Button label="Save" onPress={() => {}} testID="b" />);

    const style = styleOf(getByTestId('b'));
    expect(style.backgroundColor).toBe(colors.primary);
    expect(style.borderRadius).toBe(layout.borderRadiusMd);
    expect(style.paddingHorizontal).toBe(spacing.md);
  });

  it('gives each variant its own ground and border', async () => {
    const grounds = [];
    for (const variant of ['primary', 'secondary', 'ghost', 'destructive'] as const) {
      const { getByTestId } = await render(
        <Button label="x" variant={variant} onPress={() => {}} testID="b" />
      );
      grounds.push(styleOf(getByTestId('b')).backgroundColor);
    }

    expect(grounds[0]).toBe(colors.primary);
    expect(grounds[1]).toBe(colors.surface);
    expect(grounds[2]).toBe('transparent');
    expect(grounds[3]).toBe(colors.errorDeep);
    expect(new Set(grounds).size).toBe(4);
  });

  it('sizes sm and md apart, and both from the type scale', async () => {
    const { getByTestId: sm } = await render(
      <Button label="x" size="sm" onPress={() => {}} testID="b" />
    );
    const { getByTestId: md } = await render(<Button label="x" onPress={() => {}} testID="b" />);

    expect(styleOf(sm('b')).paddingVertical).toBeLessThan(
      styleOf(md('b')).paddingVertical as number
    );
    expect(styleOf(sm('b-label')).fontSize).toBe(typography.bodySmall.fontSize);
    expect(styleOf(md('b-label')).fontSize).toBe(typography.body.fontSize);
  });

  it('draws a small button as a smaller copy of the medium one: semibold, padded 12 a side', async () => {
    const { getByTestId: sm } = await render(
      <Button label="x" size="sm" onPress={() => {}} testID="b" />
    );
    const { getByTestId: md } = await render(<Button label="x" onPress={() => {}} testID="b" />);

    expect(styleOf(sm('b')).paddingHorizontal).toBe(spacing.smPlus);
    expect(styleOf(sm('b-label')).fontWeight).toBe('600');
    expect(styleOf(sm('b-label')).fontWeight).toBe(styleOf(md('b-label')).fontWeight);
    expect(styleOf(md('b')).paddingHorizontal).toBe(spacing.md);
    expect(styleOf(md('b-label')).fontWeight).toBe(typography.bodyBold.fontWeight);
  });

  it('reaches the platform tap-target minimum through hit slop, at either size', async () => {
    for (const size of ['sm', 'md'] as const) {
      const { getByTestId } = await render(
        <Button label="x" size={size} onPress={() => {}} testID="b" />
      );
      expect(reachHeight(getByTestId('b'))).toBeGreaterThanOrEqual(layout.minTapTarget);
    }
  });

  it('takes the platform minimum, 44 on iOS against 48 on Android', () => {
    expect(MIN_TAP_TARGET).toEqual({ ios: 44, android: 48 });
    expect(layout.minTapTarget).toBe(MIN_TAP_TARGET[Platform.OS === 'android' ? 'android' : 'ios']);
  });

  it('does not fire onPress while disabled', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <Button label="x" disabled onPress={onPress} testID="b" />
    );

    await fireEvent.press(getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('b').props.accessibilityState.disabled).toBe(true);
  });

  it('does not fire onPress while loading, and says it is busy', async () => {
    const onPress = jest.fn();
    const { getByTestId, queryByText } = await render(
      <Button label="Save" loading onPress={onPress} testID="b" />
    );

    await fireEvent.press(getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('b').props.accessibilityState.busy).toBe(true);
    expect(getByTestId('b-spinner')).toBeTruthy();
    expect(queryByText('Save')).not.toBeNull();
  });

  it('keeps its label in the layout while loading, hidden, with the spinner laid over it', async () => {
    const { getByTestId } = await render(
      <Button label="Upload" icon="cloud-upload-outline" loading onPress={() => {}} testID="b" />
    );
    const idle = await render(
      <Button label="Upload" icon="cloud-upload-outline" onPress={() => {}} testID="i" />
    );

    // The label row is laid out the same way loading or not, so the button keeps its width.
    expect(styleOf(getByTestId('b-content'))).toEqual({
      ...styleOf(idle.getByTestId('i-content')),
      opacity: 0,
    });
    expect(styleOf(getByTestId('b-spinner-frame')).position).toBe('absolute');
    expect(getByTestId('b-spinner').props.color).toBe(styleOf(getByTestId('b-label')).color);
  });

  it.each([
    ['sm', iconSize.sm],
    ['md', iconSize.md],
  ] as const)('draws a %s glyph at its icon rung in the label colour', async (size, px) => {
    for (const isDark of [false, true]) {
      mockIsDark = isDark;
      for (const variant of ['primary', 'secondary', 'ghost', 'destructive'] as const) {
        const { getByTestId, UNSAFE_getByType } = await render(
          <Button
            label="Sign in"
            icon="login"
            size={size}
            variant={variant}
            onPress={() => {}}
            testID="b"
          />
        );
        const glyph = UNSAFE_getByType(MaterialCommunityIcons);
        expect(glyph.props.name).toBe('login');
        expect(glyph.props.size).toBe(px);
        expect(glyph.props.color).toBe(styleOf(getByTestId('b-label')).color);
      }
    }
    mockIsDark = false;
  });

  it('draws a ToggleButton glyph at the small rung in its label ink, chosen or not', async () => {
    for (const selected of [false, true]) {
      const { getByTestId, UNSAFE_getByType } = await render(
        <ToggleButton
          label="Heart rate"
          icon="heart-pulse"
          selected={selected}
          onPress={() => {}}
          testID="t"
        />
      );
      const glyph = UNSAFE_getByType(MaterialCommunityIcons);
      expect(glyph.props.size).toBe(iconSize.sm);
      expect(glyph.props.color).toBe(styleOf(getByTestId('t-label')).color);
    }
  });

  it('draws a chosen ink only when the glyph asks for one', async () => {
    const { UNSAFE_getByType } = await render(
      <Button
        label="Trend"
        icon={{ name: 'minus', ink: colors.chartPink }}
        variant="ghost"
        onPress={() => {}}
      />
    );
    expect(UNSAFE_getByType(MaterialCommunityIcons).props.color).toBe(colors.chartPink);
  });

  it('fires once when it is neither', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<Button label="x" onPress={onPress} testID="b" />);

    await fireEvent.press(getByTestId('b'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a button to a screen reader, labelled by its own text', async () => {
    const { getByTestId } = await render(<Button label="Save" onPress={() => {}} testID="b" />);

    expect(getByTestId('b').props.accessibilityRole).toBe('button');
    expect(getByTestId('b').props.accessibilityLabel).toBe('Save');
  });

  it('wraps a long label inside its row and grows, rather than cutting it at large text', async () => {
    const label = 'Wiederherstellen aus einer gespeicherten Sicherungskopie jetzt';
    for (const size of ['sm', 'md'] as const) {
      const { getByTestId } = await render(
        <Button label={label} size={size} onPress={() => {}} testID="b" />
      );
      const text = getByTestId('b-label');

      expect(text.props.numberOfLines).toBeUndefined();
      expect(styleOf(text).flexShrink).toBe(1);
      expect(styleOf(text).textAlign).toBe('center');
      expect(styleOf(getByTestId('b')).height).toBeUndefined();
    }
  });

  it('carries an expanded state when it opens something, and none otherwise', async () => {
    const closed = await render(
      <Button label="x" expanded={false} onPress={() => {}} testID="b" />
    );
    expect(closed.getByTestId('b').props.accessibilityState).toMatchObject({ expanded: false });

    const open = await render(<Button label="y" expanded onPress={() => {}} testID="c" />);
    expect(open.getByTestId('c').props.accessibilityState).toMatchObject({ expanded: true });

    const plain = await render(<Button label="z" onPress={() => {}} testID="d" />);
    expect(plain.getByTestId('d').props.accessibilityState.expanded).toBeUndefined();
  });
});

describe('ToggleButton', () => {
  it('marks the selected state to a screen reader, not only in colour', async () => {
    const { getByTestId } = await render(
      <ToggleButton label="Distance" selected onPress={() => {}} testID="t" />
    );

    expect(getByTestId('t').props.accessibilityRole).toBe('button');
    expect(getByTestId('t').props.accessibilityState.selected).toBe(true);
  });

  for (const isDark of [false, true]) {
    const palette = isDark ? darkColors : colors;
    const theme = isDark ? 'dark' : 'light';
    const surfaces = isDark
      ? [
          darkColors.background,
          darkColors.surface,
          darkColors.surfaceElevated,
          darkColors.surfaceCard,
        ]
      : [colors.background, colors.surface, colors.backgroundAlt];

    it(`fills the chosen chip with the on role and the others with the neutral fill, in the ${theme} theme`, async () => {
      mockIsDark = isDark;
      const { getByTestId: on } = await render(
        <ToggleButton label="x" selected onPress={() => {}} testID="t" />
      );
      const { getByTestId: off } = await render(
        <ToggleButton label="x" onPress={() => {}} testID="t" />
      );
      mockIsDark = false;

      expect(styleOf(on('t')).backgroundColor).toBe(palette.controlOn);
      expect(styleOf(off('t')).backgroundColor).toBe(palette.fillNeutral);
    });

    it(`tells the chosen chip by a 3:1 mark on every surface, so the state survives greyscale, in the ${theme} theme`, async () => {
      mockIsDark = isDark;
      const { getByTestId: on } = await render(
        <ToggleButton label="x" selected onPress={() => {}} testID="t" />
      );
      const { getByTestId: off } = await render(
        <ToggleButton label="x" onPress={() => {}} testID="t" />
      );
      mockIsDark = false;

      for (const surface of surfaces) {
        const unselected = over(styleOf(off('t')).backgroundColor as string, surface);
        const fill = over(styleOf(on('t')).backgroundColor as string, surface);
        const outline = over(styleOf(on('t')).borderColor as string, surface);
        const step = Math.max(contrastRatio(fill, unselected), contrastRatio(outline, unselected));
        expect(step).toBeGreaterThanOrEqual(3);
      }
      expect(styleOf(on('t')).borderWidth).toBe(styleOf(off('t')).borderWidth);
    });
  }

  for (const isDark of [false, true]) {
    const palette = isDark ? darkColors : colors;
    const theme = isDark ? 'dark' : 'light';

    it(`draws a leading mark in its own colour in both states, with the label in the state's ink, in the ${theme} theme`, async () => {
      mockIsDark = isDark;
      const { getByTestId: on } = await render(
        <ToggleButton label="x" mark="#2E8B57" selected onPress={() => {}} testID="t" />
      );
      const { getByTestId: off } = await render(
        <ToggleButton label="x" mark="#2E8B57" onPress={() => {}} testID="t" />
      );
      mockIsDark = false;

      for (const chip of [on, off]) {
        const dot = styleOf(chip('t-mark'));
        expect(dot.backgroundColor).toBe('#2E8B57');
        expect(dot.width).toBe(spacing.sm);
        expect(dot.height).toBe(spacing.sm);
        expect(dot.borderWidth ?? 0).toBe(0);
      }
      expect(styleOf(on('t')).backgroundColor).toBe(palette.controlOn);
      expect(styleOf(on('t-label')).color).toBe(colors.textOnPrimary);
      expect(styleOf(off('t-label')).color).toBe(palette.textSecondary);
    });
  }

  it('draws no mark when none is given', async () => {
    const { queryByTestId } = await render(
      <ToggleButton label="x" selected onPress={() => {}} testID="t" />
    );

    expect(queryByTestId('t-mark')).toBeNull();
  });

  it('fills a chosen accent chip with the fill and sets its label in the ink given with it', async () => {
    const { getByTestId } = await render(
      <ToggleButton
        label="x"
        selected
        accent={{ fill: '#F2D16B', ink: '#1A1A1A' }}
        onPress={() => {}}
        testID="t"
      />
    );

    expect(styleOf(getByTestId('t')).backgroundColor).toBe('#F2D16B');
    expect(styleOf(getByTestId('t-label')).color).toBe('#1A1A1A');
  });

  it('refuses an accent fill without its ink at compile time', () => {
    const fillAlone = (
      // @ts-expect-error a fill without its ink falls back to an ink chosen for another ground
      <ToggleButton label="x" accent={{ fill: '#F2D16B' }} onPress={() => {}} />
    );
    const looseFill = (
      // @ts-expect-error the fill is part of the accent pair, never a prop of its own
      <ToggleButton label="x" fill="#F2D16B" onPress={() => {}} />
    );

    expect([fillAlone, looseFill]).toHaveLength(2);
  });

  it('keeps 8 pt between the drawn edges of adjacent chips in a row', async () => {
    const { toJSON } = await render(
      <ToggleButtonRow
        options={[
          { value: 'a', label: 'A', testID: 'a' },
          { value: 'b', label: 'B', testID: 'b' },
        ]}
        value="a"
        onValueChange={() => {}}
      />
    );

    const row = toJSON() as { props: { style?: unknown } };
    expect(styleOf(row).gap).toBe(spacing.sm);
  });

  it('keeps a chip label on one line, since chips sit in a horizontal row', async () => {
    const { getByTestId } = await render(
      <ToggleButton label="A long option label" count={3} onPress={() => {}} testID="t" />
    );

    expect(getByTestId('t-label').props.numberOfLines).toBe(1);
  });

  it('reaches the tap target through hit slop like every other button', async () => {
    const { getByTestId } = await render(<ToggleButton label="x" onPress={() => {}} testID="t" />);

    expect(reachHeight(getByTestId('t'))).toBeGreaterThanOrEqual(layout.minTapTarget);
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ToggleButton label="x" disabled onPress={onPress} testID="t" />
    );

    await fireEvent.press(getByTestId('t'));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('selection haptic', () => {
  const haptics = jest.requireMock('@/shared/ui/haptics') as Record<string, jest.Mock>;

  beforeEach(() => jest.clearAllMocks());

  it('ticks once when a press selects an unselected chip', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ToggleButton label="x" selected={false} onPress={onPress} testID="t" />
    );
    await fireEvent.press(getByTestId('t'));
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('stays still when the chip pressed is already the chosen one', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ToggleButton label="x" selected onPress={onPress} testID="t" />
    );
    await fireEvent.press(getByTestId('t'));
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('neither ticks nor fires while disabled', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ToggleButton label="x" disabled onPress={onPress} testID="t" />
    );
    await fireEvent.press(getByTestId('t'));
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ticks once per change in a row, and a press on the chosen option reports nothing', async () => {
    const onValueChange = jest.fn();
    const { getByTestId } = await render(
      <ToggleButtonRow
        options={[
          { value: 'a', label: 'A', testID: 'a' },
          { value: 'b', label: 'B', testID: 'b' },
        ]}
        value="a"
        onValueChange={onValueChange}
      />
    );
    await fireEvent.press(getByTestId('a'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('b'));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(haptics.selection).toHaveBeenCalledTimes(1);
  });
});

describe('destructive press haptic', () => {
  const haptics = jest.requireMock('@/shared/ui/haptics') as Record<string, jest.Mock>;

  beforeEach(() => jest.clearAllMocks());

  it('fires one medium impact and the caller press for a destructive button', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <Button label="Remove" variant="destructive" onPress={onPress} testID="b" />
    );
    await fireEvent.press(getByTestId('b'));
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.light).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('leaves the haptic to the confirm when the press only opens one', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <Button label="Delete" variant="destructive" opensConfirm onPress={onPress} testID="b" />
    );
    await fireEvent.press(getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.medium).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'ghost'] as const)(
    'fires no haptic for a %s button',
    async (variant) => {
      const onPress = jest.fn();
      const { getByTestId } = await render(
        <Button label="Go" variant={variant} onPress={onPress} testID="b" />
      );
      await fireEvent.press(getByTestId('b'));
      expect(onPress).toHaveBeenCalledTimes(1);
      for (const fn of Object.values(haptics)) expect(fn).not.toHaveBeenCalled();
    }
  );

  it.each([{ disabled: true }, { loading: true }])(
    'fires neither the haptic nor the press for a destructive button that is %o',
    async (state) => {
      const onPress = jest.fn();
      const { getByTestId } = await render(
        <Button label="Remove" variant="destructive" onPress={onPress} testID="b" {...state} />
      );
      await fireEvent.press(getByTestId('b'));
      expect(onPress).not.toHaveBeenCalled();
      expect(haptics.medium).not.toHaveBeenCalled();
    }
  );
});

describe('ghost button under Button Shapes', () => {
  afterEach(() => {
    mockButtonShapes = false;
    mockIsDark = false;
  });

  it('draws the secondary edge in each theme when the setting is on', () => {
    for (const isDark of [false, true]) {
      const palette = isDark ? darkColors : colors;
      const ghost = paint('ghost', isDark, true);
      expect(ghost.borderColor).toBe(palette.controlBoundary);
      expect(ghost.borderWidth).toBe(stroke.one);
      expect(ghost.borderColor).toBe(paint('secondary', isDark, true).borderColor);
      expect(ghost.backgroundColor).toBe('transparent');
      expect(ghost.color).toBe(palette.actionLink);
    }
  });

  it('keeps the same border width with the setting off, so turning it on moves no layout', () => {
    const off = paint('ghost', false, false);
    expect(off.borderColor).toBe('transparent');
    expect(off.borderWidth).toBe(stroke.one);
  });

  it('changes no other variant', () => {
    for (const variant of ['primary', 'secondary', 'destructive'] as const) {
      for (const isDark of [false, true]) {
        expect(paint(variant, isDark, true)).toEqual(paint(variant, isDark, false));
      }
    }
  });

  it('draws the edge on a rendered ghost button when the setting is on', async () => {
    mockButtonShapes = true;
    const { getByTestId } = await render(
      <Button label="Create account" variant="ghost" onPress={() => {}} testID="b" />
    );
    const style = styleOf(getByTestId('b'));
    expect(style.borderColor).toBe(colors.controlBoundary);
    expect(style.borderWidth).toBe(stroke.one);
  });

  it('draws no edge on a rendered ghost button when the setting is off', async () => {
    const { getByTestId } = await render(
      <Button label="Create account" variant="ghost" onPress={() => {}} testID="b" />
    );
    const style = styleOf(getByTestId('b'));
    expect(style.borderColor).toBe('transparent');
    expect(style.borderWidth).toBe(stroke.one);
  });
});
