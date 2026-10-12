/**
 * Scenario: a sheet that edits or confirms something carries a Cancel and a confirming action,
 * and each platform puts them in its own place.
 *
 * Expected behaviour: the title is a heading on both platforms. On iOS Cancel leads the title row
 * and the confirm trails it in bold, and nothing is drawn below the content. On Android the title
 * row carries no control at all, and the actions are a bottom row of a ghost Cancel then the
 * primary confirm. An Android sheet with nothing to confirm has no dismiss control of its own,
 * since drag, scrim and back dismiss it.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SheetActions, SheetHeader, type SheetHeaderProps } from '@/shared/ui/SheetHeader';
import { colors } from '@/theme';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const realOS = Platform.OS;

afterEach(() => {
  Platform.OS = realOS;
});

type Node = { props: { testID?: string; style?: unknown }; children?: (Node | string)[] | null };

/** Every testID in the rendered tree, in reading order. */
function testIdsInOrder(node: Node | Node[] | null): string[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(testIdsInOrder);
  const own = node.props.testID ? [node.props.testID] : [];
  const children = (node.children ?? []).filter((c): c is Node => typeof c !== 'string');
  return [...own, ...children.flatMap(testIdsInOrder)];
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const resolved =
    typeof style === 'function'
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
}

async function renderSheet(props: Partial<SheetHeaderProps> = {}) {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  const header: SheetHeaderProps = {
    title: 'Edit distance',
    testID: 'sheet-header',
    onCancel,
    cancelTestID: 'sheet-cancel',
    confirm: { label: 'Save', onPress: onConfirm, testID: 'sheet-confirm' },
    ...props,
  };
  await render(
    <View>
      <SheetHeader {...header} />
      <View testID="sheet-body" />
      <SheetActions {...header} testID="sheet-actions" />
    </View>
  );
  return { onCancel, onConfirm };
}

describe('SheetHeader', () => {
  it.each(['ios', 'android'] as const)('gives the title the header role on %s', async (os) => {
    Platform.OS = os;
    await renderSheet();
    expect(screen.getByRole('header').props.children).toBe('Edit distance');
  });

  it('leads with Cancel and trails with a bold confirm in the title row on iOS', async () => {
    Platform.OS = 'ios';
    await renderSheet();

    const order = testIdsInOrder(screen.toJSON() as Node);
    expect(order.indexOf('sheet-header')).toBeLessThan(order.indexOf('sheet-cancel'));
    expect(order.indexOf('sheet-cancel')).toBeLessThan(order.indexOf('sheet-header-title'));
    expect(order.indexOf('sheet-header-title')).toBeLessThan(order.indexOf('sheet-confirm'));
    expect(order.indexOf('sheet-confirm')).toBeLessThan(order.indexOf('sheet-body'));
    expect(screen.queryByTestId('sheet-actions')).toBeNull();

    expect(styleOf(screen.getByTestId('sheet-confirm-label')).fontWeight).toBe('600');
    expect(styleOf(screen.getByTestId('sheet-cancel-label')).fontWeight).toBe('400');
  });

  it('keeps the title row bare and puts Cancel then a primary confirm below on Android', async () => {
    Platform.OS = 'android';
    await renderSheet();

    const order = testIdsInOrder(screen.toJSON() as Node);
    expect(order.indexOf('sheet-header-title')).toBeLessThan(order.indexOf('sheet-body'));
    expect(order.indexOf('sheet-body')).toBeLessThan(order.indexOf('sheet-actions'));
    expect(order.indexOf('sheet-actions')).toBeLessThan(order.indexOf('sheet-cancel'));
    expect(order.indexOf('sheet-cancel')).toBeLessThan(order.indexOf('sheet-confirm'));

    expect(styleOf(screen.getByTestId('sheet-confirm')).backgroundColor).toBe(colors.primary);
    expect(styleOf(screen.getByTestId('sheet-cancel')).backgroundColor).toBe('transparent');
  });

  it('draws no dismiss control on an Android sheet with nothing to confirm', async () => {
    Platform.OS = 'android';
    await renderSheet({ confirm: undefined });

    expect(screen.queryByTestId('sheet-cancel')).toBeNull();
    expect(screen.queryByTestId('sheet-actions')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps Cancel in the title row on iOS when there is nothing to confirm', async () => {
    Platform.OS = 'ios';
    const { onCancel } = await renderSheet({ confirm: undefined });

    await fireEvent.press(screen.getByTestId('sheet-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('draws only the title when the sheet has no actions', async () => {
    Platform.OS = 'ios';
    await renderSheet({ onCancel: undefined, confirm: undefined });

    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('trails the title row with the shared close on an iOS sheet that only shows something', async () => {
    Platform.OS = 'ios';
    const onClose = jest.fn();
    await renderSheet({
      onCancel: undefined,
      confirm: undefined,
      onClose,
      closeTestID: 'sheet-close',
    });

    const order = testIdsInOrder(screen.toJSON() as Node);
    expect(order.indexOf('sheet-header-title')).toBeLessThan(order.indexOf('sheet-close'));
    expect(order.indexOf('sheet-close')).toBeLessThan(order.indexOf('sheet-body'));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByLabelText('common.close')).toBe(screen.getByTestId('sheet-close'));

    await fireEvent.press(screen.getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('draws no close on Android, where drag, scrim and back dismiss the sheet', async () => {
    Platform.OS = 'android';
    await renderSheet({ onCancel: undefined, confirm: undefined, onClose: jest.fn() });

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each(['ios', 'android'] as const)('draws the subtitle under the title on %s', async (os) => {
    Platform.OS = os;
    await renderSheet({ subtitle: 'Kept as one', onClose: undefined });

    const order = testIdsInOrder(screen.toJSON() as Node);
    expect(order.indexOf('sheet-header-title')).toBeLessThan(
      order.indexOf('sheet-header-subtitle')
    );
    expect(screen.getByTestId('sheet-header-subtitle').props.children).toBe('Kept as one');
    expect(screen.getAllByRole('header')).toHaveLength(1);
  });

  it.each(['ios', 'android'] as const)('answers Cancel and the confirm on %s', async (os) => {
    Platform.OS = os;
    const { onCancel, onConfirm } = await renderSheet();

    await fireEvent.press(screen.getByTestId('sheet-cancel'));
    await fireEvent.press(screen.getByTestId('sheet-confirm'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each(['ios', 'android'] as const)('refuses a disabled confirm on %s', async (os) => {
    Platform.OS = os;
    const onConfirm = jest.fn();
    await renderSheet({
      confirm: { label: 'Save', onPress: onConfirm, disabled: true, testID: 'sheet-confirm' },
    });

    const confirm = screen.getByTestId('sheet-confirm');
    expect(confirm.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
