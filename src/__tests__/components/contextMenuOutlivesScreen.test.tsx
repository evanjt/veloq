/**
 * Scenario: a card's menu is open on Android when the athlete presses back, or
 * when a link or a notification moves the app to another tab; or a menu is open
 * on a pushed screen, such as a detail sheet whose own dismiss gesture is off.
 *
 * Expected behaviour: back closes the menu and goes nowhere else, and a menu
 * whose screen loses focus closes rather than staying drawn over the next one.
 * The menu never holds its screen or changes the screen's own options, so the
 * swipe and header back stay as the screen set them.
 */

import React from 'react';
import { Platform, Text, View } from 'react-native';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, useNavigation } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import Stack from 'expo-router/stack';
import { PaperProvider } from 'react-native-paper';

import { MenuPopup } from '@/shared/ui/ContextMenu';
import { stubHardwareBack, type HardwareBack } from '../__shared__/hardwareBack';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let back: HardwareBack;
const onDismiss = jest.fn();

function OpenMenu() {
  return (
    <MenuPopup
      title="Harbour loop"
      entries={[{ key: 'open', label: 'Open', icon: 'book', onPress: jest.fn() }]}
      visible
      onDismiss={onDismiss}
    >
      <View testID="card" />
    </MenuPopup>
  );
}

function FeedWithOpenMenu() {
  return (
    <PaperProvider>
      <OpenMenu />
    </PaperProvider>
  );
}

async function renderTabs() {
  // The feed is in front with its card's menu open.
  return renderRouter(
    {
      _layout: () => (
        <Tabs>
          <Tabs.Screen name="index" />
          <Tabs.Screen name="settings" />
        </Tabs>
      ),
      index: FeedWithOpenMenu,
      settings: () => <Text>settings</Text>,
    },
    { initialUrl: '/' }
  );
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  back = stubHardwareBack();
  onDismiss.mockClear();
});

afterEach(() => {
  back.restore();
  jest.restoreAllMocks();
});

describe('an open card menu on Android', () => {
  it('takes back for itself, closing the menu and leaving the screen alone', async () => {
    const { getPathname } = await renderTabs();

    let handled = false;
    await act(() => {
      handled = back.press();
    });

    expect(handled).toBe(true);
    expect(onDismiss).toHaveBeenCalled();
    expect(getPathname()).toBe('/');
  });

  it('closes when a link moves the app to another tab', async () => {
    await renderTabs();
    expect(onDismiss).not.toHaveBeenCalled();

    await act(() => router.navigate('/settings'));

    expect(onDismiss).toHaveBeenCalled();
  });
});

let screenOptions: Record<string, unknown>[] = [];

function DetailWithOpenMenu() {
  const navigation = useNavigation();
  React.useState(() =>
    jest.spyOn(navigation, 'setOptions').mockImplementation((options) => {
      screenOptions.push(options as Record<string, unknown>);
    })
  );
  return (
    <PaperProvider>
      <OpenMenu />
    </PaperProvider>
  );
}

async function renderStack() {
  // A detail screen is pushed over the feed with its overflow menu open.
  const rendered = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>feed</Text>,
      detail: DetailWithOpenMenu,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push('/detail'));
  return rendered;
}

describe.each(['ios', 'android'] as const)('an open menu on a pushed screen on %s', (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', os);
    screenOptions = [];
  });

  it('lets the screen go back, and closes with it', async () => {
    const { getPathname } = await renderStack();

    await act(() => router.back());

    expect(getPathname()).toBe('/');
  });

  it("leaves the screen's swipe and header back as the screen set them", async () => {
    await renderStack();
    await act(() => router.back());

    expect(screenOptions).toEqual([]);
  });
});

describe('an open menu on a pushed screen, on Android back', () => {
  it('closes the menu and stays on the screen', async () => {
    const { getPathname } = await renderStack();

    let handled = false;
    await act(() => {
      handled = back.press();
    });

    expect(handled).toBe(true);
    expect(onDismiss).toHaveBeenCalled();
    expect(getPathname()).toBe('/detail');
  });
});
