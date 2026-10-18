/**
 * Scenario: on iOS a hold lifts the source with a preview of the screen it
 * leads to. The library's preview takes width and height out of its style and
 * hands them to UIKit only as the preferred size, so the native content view
 * the previewed screen is laid out in carries no size of its own. On a tablet
 * that screen is then laid out at an unbounded width, a gradient on it asks
 * for a bitmap trillions of points wide and the app aborts.
 *
 * Expected behaviour: between the native content view and the previewed
 * screen sits a box of a finite, positive width and height no larger than the
 * window, so the screen's layout is bounded whatever UIKit hands the preview.
 *
 * The route the preview draws is stood in for by a bare view.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { PaperProvider } from 'react-native-paper';

import { ContextMenu, type ContextMenuEntry } from '@/shared/ui/ContextMenu';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('expo-router/build/link/preview/HrefPreview', () => {
  const ReactActual = jest.requireActual('react');
  const { View: HostView } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('expo-router/build/link/preview/HrefPreview'),
    HrefPreview: () => ReactActual.createElement(HostView, { testID: 'previewed-screen' }),
  };
});

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  const { View: HostView } = jest.requireActual('react-native');
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children);
  // The library's preview element, held open. Its own code cannot run here,
  // because the platform it checks is fixed when the module is transformed, so
  // this does what it does: width and height leave the style for the preferred
  // size alone, and the children, or the linked route when there are none, are
  // drawn in a content view pinned to the top left with the rest of the style.
  const Preview = ({
    style,
    children,
  }: {
    style?: { width?: number; height?: number };
    children?: React.ReactNode;
  }) => {
    const { width, height, ...rest } = style ?? {};
    const { HrefPreview } = jest.requireMock('expo-router/build/link/preview/HrefPreview');
    return ReactActual.createElement(
      HostView,
      {
        testID: 'native-preview-content',
        preferredContentSize: { width: width ?? 0, height: height ?? 0 },
        style: [rest, { position: 'absolute', top: 0, left: 0 }],
      },
      children ?? ReactActual.createElement(HrefPreview, { href: '/pier' })
    );
  };
  const Link = Object.assign(passThrough, {
    Trigger: passThrough,
    Menu: passThrough,
    MenuAction: () => null,
    Preview,
  });
  return { ...jest.requireActual('expo-router'), Link };
});

const entries: ContextMenuEntry[] = [
  { key: 'moor', label: 'Moor here', icon: 'anchor', systemIcon: 'flag', onPress: jest.fn() },
];

const tabletWindow = { width: 834, height: 1194, scale: 2, fontScale: 1 };
const phoneWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };

const renderMenu = () =>
  render(
    <PaperProvider>
      <ContextMenu
        title="Pier"
        href="/pier"
        entries={entries}
        visible={false}
        onDismiss={jest.fn()}
      >
        <View testID="source" />
      </ContextMenu>
    </PaperProvider>
  );

const isHost = (node: ReactTestInstance) => typeof node.type === 'string';

/**
 * The size the previewed screen is laid out within: the tightest width and
 * height any host view between it and the native content view sets, the
 * content view included.
 */
function boundingSize(): { width: number | undefined; height: number | undefined } {
  const content = screen.getByTestId('native-preview-content');
  let node: ReactTestInstance | null = screen.getByTestId('previewed-screen').parent;
  let width: number | undefined;
  let height: number | undefined;
  while (node) {
    if (isHost(node)) {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      if (typeof style.width === 'number') width = Math.min(width ?? Infinity, style.width);
      if (typeof style.height === 'number') height = Math.min(height ?? Infinity, style.height);
    }
    if (node === content) return { width, height };
    node = node.parent;
  }
  throw new Error('the previewed screen is not inside the native content view');
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
});
afterEach(() => jest.restoreAllMocks());

describe('the context menu preview', () => {
  it('lays the previewed screen out in a finite box no larger than a tablet window', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue(tabletWindow);
    await renderMenu();

    const { width, height } = boundingSize();
    expect(Number.isFinite(width)).toBe(true);
    expect(Number.isFinite(height)).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(tabletWindow.width);
    expect(height).toBeLessThanOrEqual(tabletWindow.height);
  });

  it('lays the previewed screen out at the window it is drawn in on a phone', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue(phoneWindow);
    await renderMenu();

    expect(boundingSize()).toEqual({ width: phoneWindow.width, height: phoneWindow.height });
    expect(screen.getByTestId('native-preview-content').props.preferredContentSize).toEqual({
      width: phoneWindow.width,
      height: phoneWindow.height,
    });
  });

  it('draws no preview off iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderMenu();

    expect(screen.queryByTestId('native-preview-content')).toBeNull();
    expect(screen.queryByTestId('previewed-screen')).toBeNull();
  });
});
