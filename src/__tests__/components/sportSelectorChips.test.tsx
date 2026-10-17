/**
 * Scenario: the Fitness sport toggle and the route and section sport pills drew
 * their own pills. The toggle put a white label on the sport hue (2.5:1 on run),
 * the pills showed selection as a tint and border in the raw sport hue, and
 * neither reached the platform tap minimum.
 *
 * Expected behaviour: both draw the shared sport chip. The selected label clears
 * 4.5:1 on its fill, every chip reaches `layout.minTapTarget` through slop, and
 * the selected chip is a solid fill against a translucent wash rather than a hue
 * change alone.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SportToggleSelector } from '@/features/fitness/components/SportToggleSelector';
import { SportTypeSelector } from '@/features/routes/components/SportTypeSelector';
import { colors } from '@/theme';
import { layout } from '@/theme/layout';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false, colors: jest.requireActual('@/theme').colors }),
}));

type Slop = number | { top?: number; bottom?: number } | undefined;

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

function reachHeight(node: ReactTestInstance): number {
  const style = styleOf(node);
  const drawn = Math.max(Number(style.height ?? 0), Number(style.minHeight ?? 0));
  const slop = node.props.hitSlop as Slop;
  const side = (key: 'top' | 'bottom') => (typeof slop === 'number' ? slop : (slop?.[key] ?? 0));
  return drawn + side('top') + side('bottom');
}

/** The colour of the first text the chip draws, which is its label. */
function labelInk(chip: ReactTestInstance): string {
  const label = chip.findAllByType(Text)[0];
  return styleOf(label).color as string;
}

function channels(hex: string): number[] {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const OPAQUE = /^#[0-9a-f]{6}$/i;

function expectSportChips(selectedId: string, unselectedIds: string[]) {
  const selected = screen.getByTestId(selectedId);
  const fill = styleOf(selected).backgroundColor as string;

  expect(fill).toMatch(OPAQUE);
  expect(contrastRatio(labelInk(selected), fill)).toBeGreaterThanOrEqual(4.5);
  expect(selected.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

  for (const id of unselectedIds) {
    const chip = screen.getByTestId(id);
    expect(styleOf(chip).backgroundColor).toBe(colors.fillNeutral);
    expect(styleOf(chip).borderColor).toBe('transparent');
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
  }
  for (const id of [selectedId, ...unselectedIds]) {
    expect(reachHeight(screen.getByTestId(id))).toBeGreaterThanOrEqual(layout.minTapTarget);
  }
}

describe('sport selector chips', () => {
  it('draws the Fitness sport toggle as readable, reachable chips', async () => {
    const onChange = jest.fn();
    await render(<SportToggleSelector sportMode="Running" onSportModeChange={onChange} />);

    expectSportChips('fitness-sport-toggle-Running', [
      'fitness-sport-toggle-Cycling',
      'fitness-sport-toggle-Swimming',
    ]);
  });

  it('draws the route and section sport pills as readable, reachable chips with counts', async () => {
    await render(
      <SportTypeSelector
        options={[{ type: 'Ride', count: 12 }, { type: 'Run', count: 4 }, { type: 'VirtualRide' }]}
        selectedType="Run"
        onSelect={jest.fn()}
      />
    );

    expectSportChips('sport-pill-Run', ['sport-pill-Ride', 'sport-pill-VirtualRide']);
    expect(screen.getByText('activityTypes.Ride 12')).toBeTruthy();
    expect(screen.getByText('activityTypes.Run 4')).toBeTruthy();
  });

  it('hands the tapped sport to the caller, the selected one included', async () => {
    const onSelect = jest.fn();
    await render(
      <SportTypeSelector
        options={[{ type: 'Ride' }, { type: 'Run' }]}
        selectedType="Run"
        onSelect={onSelect}
      />
    );

    await fireEvent.press(screen.getByTestId('sport-pill-Ride'));
    await fireEvent.press(screen.getByTestId('sport-pill-Run'));
    expect(onSelect.mock.calls).toEqual([['Ride'], ['Run']]);
  });
});
