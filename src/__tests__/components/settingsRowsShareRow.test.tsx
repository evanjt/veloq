/**
 * Scenario: settings list rows drew their own frame, so some lacked the
 * tap-target floor and drew a second chevron or a border of their own.
 *
 * Expected behaviour: each list row renders the shared Row, whose root is at
 * least the tap-target height and has no border, with one chevron when pressable.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { layout } from '@/theme';
import { CacheManagementPanel } from '@/features/settings/components/CacheManagementPanel';
import { SettingsNavRow } from '@/features/settings/components/SettingsNavRow';
import { settingsStyles } from '@/features/settings/components/settingsStyles';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function rootStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
}

describe('settings list rows', () => {
  it('renders the clear-cache row on the shared Row with one chevron', () => {
    const onClearCache = jest.fn();
    const { getByTestId, getAllByTestId } = render(
      <CacheManagementPanel isDark={false} isDemoMode={false} onClearCache={onClearCache} />
    );
    const style = rootStyle(getByTestId('settings-clear-cache'));
    expect(style.minHeight).toBe(layout.minTapTarget);
    expect(style.borderTopWidth).toBeUndefined();
    expect(getAllByTestId('row-chevron')).toHaveLength(1);
    fireEvent.press(getByTestId('settings-clear-cache'));
    expect(onClearCache).toHaveBeenCalledTimes(1);
  });

  it('does not run the clear-cache action in demo mode', () => {
    const onClearCache = jest.fn();
    const { getByTestId } = render(
      <CacheManagementPanel isDark={false} isDemoMode onClearCache={onClearCache} />
    );
    fireEvent.press(getByTestId('settings-clear-cache'));
    expect(onClearCache).not.toHaveBeenCalled();
  });

  it('renders the nav row on the shared Row with one chevron', () => {
    const { getByTestId, getAllByTestId } = render(
      <SettingsNavRow icon="cog" title="Title" onPress={jest.fn()} testID="nav" />
    );
    const style = rootStyle(getByTestId('nav'));
    expect(style.minHeight).toBe(layout.minTapTarget);
    expect(style.borderTopWidth).toBeUndefined();
    expect(getAllByTestId('row-chevron')).toHaveLength(1);
  });

  it('keeps no row frame of its own in settingsStyles', () => {
    expect('actionRow' in settingsStyles).toBe(false);
  });
});
