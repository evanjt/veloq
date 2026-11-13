import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';

import { IconButton } from '@/shared/ui';
import { Row } from '@/shared/ui/Row';
import { SettingsNavRow } from '@/features/settings/components/SettingsNavRow';
import { layout } from '@/theme';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

describe('Row', () => {
  it('makes a navigating row a full-height button with a chevron', async () => {
    const onPress = jest.fn();
    const { getByRole, getByTestId } = await render(
      <Row behaviour="navigate" onPress={onPress} accessibilityLabel="Open details" testID="row">
        <Text>Details</Text>
      </Row>
    );

    const row = getByRole('button', { name: 'Open details' });
    expect(StyleSheet.flatten(row.props.style) as object).toMatchObject({
      minHeight: layout.minTapTarget,
    });
    expect(getByTestId('row-chevron', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps a trailing accessory a separate control beside a pressable row', async () => {
    const onPress = jest.fn();
    const onAccessory = jest.fn();
    const { getByRole } = await render(
      <Row
        behaviour="navigate"
        onPress={onPress}
        accessibilityLabel="Open details"
        accessory={
          <IconButton accessibilityLabel="About details" onPress={onAccessory}>
            <Text>i</Text>
          </IconButton>
        }
      >
        <Text>Details</Text>
      </Row>
    );

    const row = getByRole('button', { name: 'Open details' });
    const accessory = getByRole('button', { name: 'About details' });
    expect(within(row).queryByRole('button', { name: 'About details' })).toBeNull();

    await fireEvent.press(accessory);
    expect(onAccessory).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws no chevron on a row that acts where it stands', async () => {
    const onPress = jest.fn();
    const { getByRole, queryByTestId } = await render(
      <Row behaviour="act" onPress={onPress} accessibilityLabel="Empty the bin" testID="row">
        <Text>Empty the bin</Text>
      </Row>
    );

    const row = getByRole('button', { name: 'Empty the bin' });
    expect(StyleSheet.flatten(row.props.style) as object).toMatchObject({
      minHeight: layout.minTapTarget,
    });
    expect(queryByTestId('row-chevron', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders an inline-control row without a button role or chevron', async () => {
    const { queryByRole, queryByTestId, getByTestId } = await render(
      <Row testID="row">
        <Text>Sync</Text>
      </Row>
    );

    expect(queryByRole('button')).toBeNull();
    expect(queryByTestId('row-chevron', { includeHiddenElements: true })).toBeNull();
    const style = StyleSheet.flatten(getByTestId('row').props.style) as Record<string, unknown>;
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderTopWidth).toBeUndefined();
    expect(style.borderBottomWidth).toBeUndefined();
  });
});

describe('SettingsNavRow', () => {
  it('uses the shared row frame and one chevron', async () => {
    const { getByTestId, getAllByTestId } = await render(
      <SettingsNavRow icon="cog" title="Settings" onPress={() => {}} testID="settings-row" />
    );
    expect(StyleSheet.flatten(getByTestId('settings-row').props.style) as object).toMatchObject({
      minHeight: layout.minTapTarget,
    });
    expect(getAllByTestId('row-chevron', { includeHiddenElements: true })).toHaveLength(1);
  });
});
