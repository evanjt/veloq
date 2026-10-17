/**
 * Scenario: the anchored popup a hold opens on Android, and a screen reader
 * opens on either platform.
 *
 * Expected behaviour: every row is at least the Android tap target high on both
 * platforms, the title, group label and row label are the named text styles
 * rather than a size with a weight picked beside it, groups are parted by a
 * hairline, and the popup is raised by a shadow in light and by an edge with
 * no shadow in dark, at the medium radius and no wider than 280.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { ContextMenu, type ContextMenuEntry } from '@/shared/ui/ContextMenu';
import { darkColors, layout, MIN_TAP_TARGET, shadows, typography } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

const entries: ContextMenuEntry[] = [
  { key: 'open', label: 'Open the log', icon: 'book', systemIcon: 'book', onPress: jest.fn() },
  {
    key: 'tide',
    label: 'Tide',
    icon: 'waves',
    systemIcon: 'water.waves',
    items: [
      {
        key: 'high',
        label: 'High water',
        icon: 'arrow-up',
        systemIcon: 'arrow.up',
        onPress: jest.fn(),
        checked: true,
      },
      {
        key: 'low',
        label: 'Low water',
        icon: 'arrow-down',
        systemIcon: 'arrow.down',
        onPress: jest.fn(),
        checked: false,
      },
    ],
  },
];

const renderPopup = () =>
  render(
    <PaperProvider>
      <ContextMenu title="Harbour log" href="/" entries={entries} visible onDismiss={jest.fn()}>
        <View testID="source" />
      </ContextMenu>
    </PaperProvider>
  );

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const namedStyle = (style: Record<string, unknown>) => {
  const { fontFamily: _family, ...rest } = style;
  return rest;
};

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockIsDark = false;
});
afterEach(() => jest.restoreAllMocks());

describe('the context menu popup', () => {
  it('draws every row at least the Android tap target high', async () => {
    await renderPopup();

    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(flat(row).minHeight).toBeGreaterThanOrEqual(MIN_TAP_TARGET.android);
    }
  });

  it('sets the title, group label and row labels in the named text styles', async () => {
    await renderPopup();

    expect(flat(screen.getByText('Harbour log'))).toMatchObject(namedStyle(typography.captionBold));
    expect(flat(screen.getByText('Tide'))).toMatchObject(namedStyle(typography.sectionHeader));
    for (const label of ['Open the log', 'High water', 'Low water']) {
      expect(flat(screen.getByText(label))).toMatchObject(namedStyle(typography.bodyMedium));
    }
  });

  it('parts a group from what comes before it with a hairline', async () => {
    await renderPopup();

    const group = screen.getByLabelText('Tide');
    expect(flat(group).borderTopWidth).toBe(StyleSheet.hairlineWidth);
  });

  it('raises the light popup with the elevated shadow at the medium radius', async () => {
    await renderPopup();

    const surface = flat(screen.getByTestId('context-menu-surface'));
    expect(surface).toMatchObject({ ...shadows.elevated, borderRadius: layout.borderRadiusMd });
    expect(surface.borderWidth ?? 0).toBe(0);
    expect(surface.maxWidth).toBeLessThanOrEqual(280);
  });

  it('raises the dark popup with an edge and no shadow', async () => {
    mockIsDark = true;
    await renderPopup();

    const surface = flat(screen.getByTestId('context-menu-surface'));
    expect(surface).toMatchObject({
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: darkColors.border,
      borderRadius: layout.borderRadiusMd,
    });
    expect(surface.elevation ?? 0).toBe(0);
    expect(surface.shadowOpacity ?? 0).toBe(0);
  });
});
