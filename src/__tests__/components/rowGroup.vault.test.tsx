/**
 * Scenario: each group of rows drew its own divider, at 1px or a hairline, in
 * one of four colours and at an inset sized for a 22px icon.
 *
 * Expected behaviour: the group draws one soft divider between each pair of
 * its rows, a hairline in the border colour of either theme, inset past a
 * 24px leading icon, and none before the first row or after the last.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { RowDivider, RowGroup, ROW_DIVIDER_INSET } from '@/shared/ui/RowGroup';
import { colors, darkColors, iconSize, spacing } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) ?? {};

afterEach(() => {
  mockIsDark = false;
});

describe('RowGroup', () => {
  it('insets the divider past a 24px leading icon', () => {
    expect(ROW_DIVIDER_INSET).toBe(spacing.md + iconSize.lg + spacing.sm);
    expect(ROW_DIVIDER_INSET).toBe(48);
  });

  it.each([
    ['light', false, colors.border],
    ['dark', true, darkColors.border],
  ])('draws one hairline divider between two rows in %s', async (_name, isDark, colour) => {
    mockIsDark = isDark;
    const { getAllByTestId } = await render(
      <RowGroup>
        <Text>Gears</Text>
        <Text>Chains</Text>
      </RowGroup>
    );
    const dividers = getAllByTestId('row-divider');
    expect(dividers).toHaveLength(1);
    expect(flat(dividers[0]!)).toMatchObject({
      height: StyleSheet.hairlineWidth,
      backgroundColor: colour,
      marginLeft: 48,
    });
  });

  it('draws no divider around a single row', async () => {
    const { queryAllByTestId } = await render(
      <RowGroup>
        <Text>Gears</Text>
      </RowGroup>
    );
    expect(queryAllByTestId('row-divider')).toHaveLength(0);
  });

  it('skips rows that are not drawn and opens fragments', async () => {
    const hidden = false;
    const { getAllByTestId, toJSON } = await render(
      <RowGroup>
        <Text>Gears</Text>
        {hidden && <Text>Spokes</Text>}
        {null}
        <>
          <Text>Chains</Text>
          <Text>Pedals</Text>
        </>
      </RowGroup>
    );
    expect(getAllByTestId('row-divider')).toHaveLength(2);
    const order = JSON.stringify(toJSON());
    expect(order.indexOf('Gears')).toBeLessThan(order.indexOf('row-divider'));
    expect(order.lastIndexOf('row-divider')).toBeLessThan(order.indexOf('Pedals'));
  });

  it('runs the divider to the edge padding when the rows carry no icon', async () => {
    const { getByTestId } = await render(<RowDivider inset="edge" />);
    expect(flat(getByTestId('row-divider')).marginLeft).toBe(spacing.md);
  });

  it('runs the divider across the full width when asked', async () => {
    const { getByTestId } = await render(<RowDivider inset="none" />);
    expect(flat(getByTestId('row-divider')).marginLeft).toBeUndefined();
  });
});
