/**
 * Scenario: on Android the map-hero detail screens lay their header over the hero, and the stack
 * adds that header after the screen's content, so a screen reader reaches Back and the title only
 * after crossing the whole page.
 *
 * Expected behaviour: the root stack renders every route whose header is laid over its content
 * inside the native container that is read after the header, and leaves the routes with an opaque
 * header, and iOS, as they were. Sheet routes keep their frame.
 */

import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const expoModulesCore = require('expo-modules-core');
const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

function NativeReadAfterHeader(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

type RootScreenLayout = typeof import('@/shared/ui/rootScreenLayout').rootScreenLayout;

/** A fresh copy of the layout, since the container keeps the native view it first required. */
function rootScreenLayout(props: Parameters<RootScreenLayout>[0]) {
  let layout: RootScreenLayout | undefined;
  jest.isolateModules(() => {
    layout = require('@/shared/ui/rootScreenLayout').rootScreenLayout;
  });
  return layout!(props);
}

function spyOnNativeView() {
  return jest
    .spyOn(expoModulesCore, 'requireNativeViewManager')
    .mockReturnValue(NativeReadAfterHeader);
}

const overMapRoutes = Object.entries(SCREEN_HEADERS)
  .filter(([, header]) => header?.overMap)
  .map(([name]) => name);

describe('rootScreenLayout', () => {
  it('covers the three map-hero detail screens', () => {
    expect(overMapRoutes).toEqual(
      expect.arrayContaining(['activity/[id]', 'route/[id]', 'section/[id]'])
    );
  });

  it.each(overMapRoutes)(
    'on Android reads %s after its header, the content filling the screen',
    async (name) => {
      Platform.OS = 'android';
      const requireView = spyOnNativeView();

      await render(rootScreenLayout({ route: { name }, children: <Text>hero</Text> }));

      expect(requireView).toHaveBeenCalledWith('VeloqFocus', 'ReadAfterHeaderView');
      const container = screen.UNSAFE_getByType(NativeReadAfterHeader);
      expect(StyleSheet.flatten(container.props.style)).toMatchObject({ flex: 1 });
      expect(screen.getByText('hero')).toBeTruthy();
    }
  );

  it('leaves a route with an opaque header as it is', async () => {
    Platform.OS = 'android';
    spyOnNativeView();

    await render(rootScreenLayout({ route: { name: 'settings' }, children: <Text>rows</Text> }));

    expect(screen.UNSAFE_queryAllByType(NativeReadAfterHeader)).toHaveLength(0);
    expect(screen.getByText('rows')).toBeTruthy();
  });

  it('leaves iOS as it is, where the header is read first already', async () => {
    Platform.OS = 'ios';
    const requireView = spyOnNativeView();

    await render(
      rootScreenLayout({ route: { name: 'activity/[id]' }, children: <Text>hero</Text> })
    );

    expect(requireView).not.toHaveBeenCalled();
    expect(screen.getByText('hero')).toBeTruthy();
  });

  it('still frames a sheet route', async () => {
    Platform.OS = 'android';
    spyOnNativeView();

    await render(
      rootScreenLayout({ route: { name: 'sheets/insight' }, children: <Text>body</Text> })
    );

    expect(screen.getByTestId('sheet-frame')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(NativeReadAfterHeader)).toHaveLength(0);
  });
});
