/**
 * Scenario: on iOS a hold opens the system menu, so the anchored popup is
 * drawn only when a screen reader asks for it. An automation driver reads the
 * view tree to a fixed depth, and every wrapper between a list cell and its
 * card pushes the card's accessibility id towards that limit.
 *
 * Expected behaviour: while the popup is closed the source is drawn with no
 * host view of the menu around it, and it is wrapped in the anchored popup,
 * with its entries, while the popup is open.
 */

import React from 'react';
import { Platform, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { PaperProvider } from 'react-native-paper';

import { ContextMenu, type ContextMenuEntry } from '@/shared/ui/ContextMenu';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children);
  const Link = Object.assign(passThrough, {
    Trigger: passThrough,
    Menu: passThrough,
    MenuAction: () => null,
    Preview: () => null,
  });
  return { ...jest.requireActual('expo-router'), Link };
});

const entries: ContextMenuEntry[] = [
  { key: 'moor', label: 'Moor here', icon: 'anchor', systemIcon: 'flag', onPress: jest.fn() },
];

const renderMenu = (visible: boolean) =>
  render(
    <PaperProvider>
      <View testID="probe" />
      <ContextMenu
        title="Pier"
        href="/pier"
        entries={entries}
        visible={visible}
        onDismiss={jest.fn()}
      >
        <View testID="source" />
      </ContextMenu>
    </PaperProvider>
  );

function hostAncestors(node: ReactTestInstance): number {
  let count = 0;
  for (let n = node.parent; n; n = n.parent) if (typeof n.type === 'string') count += 1;
  return count;
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
});

describe('the context menu source on iOS', () => {
  it('draws the source with no menu wrapper while the popup is closed', async () => {
    await renderMenu(false);
    expect(hostAncestors(screen.getByTestId('source'))).toBe(
      hostAncestors(screen.getByTestId('probe'))
    );
  });

  it('draws the anchored popup around the source while it is open', async () => {
    await renderMenu(true);
    expect(screen.getByTestId('source')).toBeTruthy();
    expect(screen.getByText('Moor here')).toBeTruthy();
  });
});
