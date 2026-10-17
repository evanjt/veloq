/**
 * Scenario: the tip options sit on a card or a settings section that already
 * carries its own primary action, and each drew a filled primary of its own,
 * so the row read as three primaries side by side.
 *
 * Expected behaviour: each option is a second-rank control in both themes, its
 * price clears 4.5:1 on its ground, and a screen reader hears the size before
 * the price.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TipButtons } from '@/shared/ui/TipButtons';
import { colors, darkColors } from '@/theme';

import { AA_TEXT, contrastRatio } from '../__shared__/contrast';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

afterEach(() => {
  mockIsDark = false;
});

const PRODUCTS = [
  { id: 'tip_large', displayPrice: '$10' },
  { id: 'tip_small', displayPrice: '$1' },
  { id: 'tip_medium', displayPrice: '$5' },
];

function flattened(style: unknown): Record<string, unknown> {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (StyleSheet.flatten(resolved as never) ?? {}) as Record<string, unknown>;
}

describe.each([
  ['light', false, colors],
  ['dark', true, darkColors],
] as const)('tip options in the %s theme', (_name, isDark, palette) => {
  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws no option on the primary fill, and each price clears 4.5:1 on its ground', async () => {
    const { getAllByRole, getByText } = await render(
      <TipButtons products={PRODUCTS} isPurchasing={false} onTip={() => {}} />
    );
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const [button, price] of buttons.map((b, i) => [b, ['$1', '$5', '$10'][i]] as const)) {
      const ground = flattened(button.props.style).backgroundColor as string;
      expect(ground).not.toBe(colors.actionPrimary);
      expect(ground).not.toBe(darkColors.actionPrimary);
      expect(ground).toBe(palette.surface);
      const ink = flattened(getByText(price).props.style).color as string;
      expect(contrastRatio(ink, ground)).toBeGreaterThan(AA_TEXT);
    }
  });
});

it('names each option by its size and then its price, smallest first', async () => {
  const { getAllByRole } = await render(
    <TipButtons products={PRODUCTS} isPurchasing={false} onTip={() => {}} />
  );
  expect(getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
    'support.tipSmall $1',
    'support.tipMedium $5',
    'support.tipLarge $10',
  ]);
});

it('passes the chosen product to the purchase', async () => {
  const onTip = jest.fn();
  const { getByText } = await render(
    <TipButtons products={PRODUCTS} isPurchasing={false} onTip={onTip} />
  );
  fireEvent.press(getByText('$5'));
  expect(onTip).toHaveBeenCalledWith('tip_medium');
});

it('refuses a second purchase while one is running', async () => {
  const onTip = jest.fn();
  const { getAllByRole, getByText } = await render(
    <TipButtons products={PRODUCTS} isPurchasing onTip={onTip} />
  );
  for (const button of getAllByRole('button')) {
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  }
  fireEvent.press(getByText('$1'));
  expect(onTip).not.toHaveBeenCalled();
});
