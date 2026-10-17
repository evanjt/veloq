/**
 * Scenario: on iOS a hold lifts the source with a preview of the screen it
 * leads to. Given no size, the preview is laid out at whatever width UIKit
 * hands it, and on a tablet that width is unbounded, so a gradient on the
 * previewed screen asks for a bitmap trillions of points wide and the app
 * aborts.
 *
 * Expected behaviour: the preview always asks for a finite, positive size no
 * larger than the window.
 */

import React from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { ContextMenu, type ContextMenuEntry } from '@/shared/ui/ContextMenu';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const mockPreviewStyles: unknown[] = [];
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children);
  const Link = Object.assign(passThrough, {
    Trigger: passThrough,
    Menu: passThrough,
    MenuAction: () => null,
    Preview: ({ style }: { style?: unknown }) => {
      mockPreviewStyles.push(style);
      return null;
    },
  });
  return { ...jest.requireActual('expo-router'), Link };
});

const entries: ContextMenuEntry[] = [
  { key: 'moor', label: 'Moor here', icon: 'anchor', systemIcon: 'flag', onPress: jest.fn() },
];

const tabletWindow = { width: 834, height: 1194, scale: 2, fontScale: 1 };

const renderMenu = () =>
  render(
    <PaperProvider>
      <ContextMenu title="Pier" href="/" entries={entries} visible={false} onDismiss={jest.fn()}>
        <View testID="source" />
      </ContextMenu>
    </PaperProvider>
  );

const lastPreviewSize = () =>
  mockPreviewStyles[mockPreviewStyles.length - 1] as
    | { width?: number; height?: number }
    | undefined;

beforeEach(() => {
  mockPreviewStyles.length = 0;
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => jest.restoreAllMocks());

describe('the context menu preview', () => {
  it('asks for a finite size no larger than a tablet window', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue(tabletWindow);
    await renderMenu();

    const size = lastPreviewSize();
    expect(Number.isFinite(size?.width)).toBe(true);
    expect(Number.isFinite(size?.height)).toBe(true);
    expect(size?.width).toBeGreaterThan(0);
    expect(size?.height).toBeGreaterThan(0);
    expect(size?.width).toBeLessThanOrEqual(tabletWindow.width);
    expect(size?.height).toBeLessThanOrEqual(tabletWindow.height);
  });

  it('asks for the window it is drawn in on a phone', async () => {
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    await renderMenu();

    expect(lastPreviewSize()).toEqual({ width: 390, height: 844 });
  });

  it('draws no preview off iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderMenu();

    expect(mockPreviewStyles).toHaveLength(0);
  });
});
