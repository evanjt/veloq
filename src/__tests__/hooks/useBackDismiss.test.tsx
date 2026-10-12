/**
 * Scenario: a transient state (a menu, a popup, an edit mode) is open when the
 * athlete goes back, on a screen outside any navigator, on a stack screen and
 * on a tab root.
 *
 * Expected behaviour: while the state is active, back ends it and nothing
 * else: Android's back is consumed and a stack screen is not removed. Once it
 * is inactive back navigates as before, and a tab the athlete has left does not
 * take back from the tab in front.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { router, useNavigation } from 'expo-router';
import Stack from 'expo-router/stack';
import Tabs from 'expo-router/tabs';

import { useBackDismiss } from '@/shared/app/useBackDismiss';
import { stubHardwareBack, type HardwareBack } from '../__shared__/hardwareBack';

jest.unmock('expo-router');

let back: HardwareBack;
let pathname: () => string = () => '';

beforeEach(() => {
  back = stubHardwareBack();
});

afterEach(() => {
  back.restore();
});

describe('useBackDismiss outside a navigator', () => {
  it('consumes back and dismisses once while active', async () => {
    const onDismiss = jest.fn();
    await renderHook(() => useBackDismiss(true, onDismiss));

    expect(back.press()).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves back alone while inactive', async () => {
    const onDismiss = jest.fn();
    await renderHook(() => useBackDismiss(false, onDismiss));

    expect(back.press()).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('lets go of back when the state ends, and calls the latest dismiss', async () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = await renderHook(
      ({ active, onDismiss }: { active: boolean; onDismiss: () => void }) =>
        useBackDismiss(active, onDismiss),
      { initialProps: { active: true, onDismiss: first } }
    );

    await rerender({ active: true, onDismiss: latest });
    expect(back.press()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);

    await rerender({ active: false, onDismiss: latest });
    expect(back.listeners()).toBe(0);
    expect(back.press()).toBe(false);
  });

  it('dismisses the state opened last first', async () => {
    const menu = jest.fn();
    const popup = jest.fn();
    const { rerender } = await renderHook(
      ({ menuOpen }: { menuOpen: boolean }) => {
        useBackDismiss(true, popup);
        useBackDismiss(menuOpen, menu);
      },
      { initialProps: { menuOpen: false } }
    );

    await rerender({ menuOpen: true });
    back.press();
    expect(menu).toHaveBeenCalledTimes(1);
    expect(popup).not.toHaveBeenCalled();
  });
});

const stackDismiss = jest.fn();
let stackActive = true;
let stackOptions: Record<string, unknown>[] = [];

// Records what the screen's options are set to.
function useRecordedOptions() {
  const navigation = useNavigation();
  React.useState(() =>
    jest.spyOn(navigation, 'setOptions').mockImplementation((options) => {
      stackOptions.push(options as Record<string, unknown>);
    })
  );
}

function EditingScreen() {
  useRecordedOptions();
  const [active, setActive] = React.useState(stackActive);
  useBackDismiss(active, () => {
    stackDismiss();
    setActive(false);
  });
  return <Text testID="editing">{active ? 'editing' : 'viewing'}</Text>;
}

function TwoModeScreen() {
  useRecordedOptions();
  const [trimming, setTrimming] = React.useState(true);
  const [renaming, setRenaming] = React.useState(true);
  useBackDismiss(trimming, () => setTrimming(false));
  useBackDismiss(renaming, () => setRenaming(false));
  return <Text>{`${trimming} ${renaming}`}</Text>;
}

async function renderStack() {
  pathname = renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>home</Text>,
      detail: EditingScreen,
    },
    { initialUrl: '/' }
  ).getPathname;
  await act(() => router.push('/detail'));
}

describe('useBackDismiss on a stack screen', () => {
  beforeEach(() => {
    stackDismiss.mockClear();
    stackActive = true;
    stackOptions = [];
  });

  it('holds the screen on a goBack and ends the state instead', async () => {
    await renderStack();

    await act(() => router.back());

    expect(pathname()).toBe('/detail');
    expect(stackDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('editing')).toHaveTextContent('viewing');
  });

  it('turns the swipe and the header back off while active, and back on after', async () => {
    await renderStack();
    expect(stackOptions.at(-1)).toEqual({ gestureEnabled: false, headerBackVisible: false });

    await act(() => router.back());

    expect(stackOptions.at(-1)).toEqual({ gestureEnabled: true, headerBackVisible: true });
  });

  it('ends the state on Android back without leaving the screen', async () => {
    await renderStack();

    await act(() => {
      expect(back.press()).toBe(true);
    });

    expect(pathname()).toBe('/detail');
    expect(stackDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves the screen on the next back once the state has ended', async () => {
    await renderStack();
    await act(() => router.back());

    await act(() => router.back());

    expect(pathname()).toBe('/');
    expect(stackDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the swipe off until the last of two states on the screen ends', async () => {
    pathname = renderRouter(
      {
        _layout: () => <Stack />,
        index: () => <Text>home</Text>,
        detail: TwoModeScreen,
      },
      { initialUrl: '/' }
    ).getPathname;
    await act(() => router.push('/detail'));
    expect(stackOptions).toEqual([{ gestureEnabled: false, headerBackVisible: false }]);

    await act(() => router.back());
    expect(stackOptions).toHaveLength(1);

    await act(() => router.back());
    expect(stackOptions.at(-1)).toEqual({ gestureEnabled: true, headerBackVisible: true });
    expect(pathname()).toBe('/detail');
  });

  it('does not hold the screen while inactive', async () => {
    stackActive = false;
    await renderStack();

    await act(() => router.back());

    expect(pathname()).toBe('/');
    expect(stackDismiss).not.toHaveBeenCalled();
    expect(stackOptions).toEqual([]);
  });
});

const tabDismiss = jest.fn();

// The menu opens on a tap after the tabs have mounted, as on the Map tab, so
// the navigator's own back listener is already registered beneath it.
function MenuTab() {
  const [open, setOpen] = React.useState(false);
  useBackDismiss(open, () => {
    tabDismiss();
    setOpen(false);
  });
  return (
    <Text testID="menu" onPress={() => setOpen(true)}>
      {open ? 'open' : 'closed'}
    </Text>
  );
}

async function renderTabs() {
  pathname = renderRouter(
    {
      _layout: () => <Tabs />,
      index: () => <Text>feed</Text>,
      map: MenuTab,
    },
    { initialUrl: '/map' }
  ).getPathname;
  await fireEvent.press(screen.getByTestId('menu'));
}

describe('useBackDismiss on a tab root', () => {
  beforeEach(() => tabDismiss.mockClear());

  it('closes the open state on back while its tab is in front', async () => {
    await renderTabs();

    await act(() => {
      expect(back.press()).toBe(true);
    });

    expect(tabDismiss).toHaveBeenCalledTimes(1);
    expect(pathname()).toBe('/map');
    expect(screen.getByTestId('menu')).toHaveTextContent('closed');
  });

  it('leaves back to the tab in front once the athlete has moved away', async () => {
    await renderTabs();
    await act(() => router.navigate('/'));

    await act(() => {
      back.press();
    });

    expect(tabDismiss).not.toHaveBeenCalled();
  });
});
