import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Row } from '@/shared/ui/Row';
import { SettingsNavRow } from '@/features/settings/components/SettingsNavRow';
import { layout } from '@/theme';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

describe('Row', () => {
  it('makes a pressable row a full-height button with a chevron', () => {
    const onPress = jest.fn();
    const { getByRole, getByTestId } = render(
      <Row onPress={onPress} accessibilityLabel="Open details" testID="row">
        <Text>Details</Text>
      </Row>
    );

    const row = getByRole('button', { name: 'Open details' });
    expect(StyleSheet.flatten(row.props.style) as object).toMatchObject({
      minHeight: layout.minTapTarget,
    });
    expect(getByTestId('row-chevron')).toBeTruthy();
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders an inline-control row without a button role or chevron', () => {
    const { queryByRole, queryByTestId, getByTestId } = render(
      <Row testID="row">
        <Text>Sync</Text>
      </Row>
    );

    expect(queryByRole('button')).toBeNull();
    expect(queryByTestId('row-chevron')).toBeNull();
    const style = StyleSheet.flatten(getByTestId('row').props.style) as Record<string, unknown>;
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderTopWidth).toBeUndefined();
    expect(style.borderBottomWidth).toBeUndefined();
  });
});

describe('SettingsNavRow', () => {
  it('uses the shared row frame and one chevron', () => {
    const { getByTestId, getAllByTestId } = render(
      <SettingsNavRow icon="cog" title="Settings" onPress={() => {}} testID="settings-row" />
    );
    expect(StyleSheet.flatten(getByTestId('settings-row').props.style) as object).toMatchObject({
      minHeight: layout.minTapTarget,
    });
    expect(getAllByTestId('row-chevron')).toHaveLength(1);
  });
});
