/**
 * Scenario: the tab bar draws only inside the tabs group, and the system navigation bar or home
 * indicator draws under every screen. Every view that meets the bottom edge reads its clearance
 * from one place, which knows both and whether a safe area above it already took the inset.
 *
 * Expected behaviour: a route in the tabs group clears the bar and the inset under it; a stack
 * route clears the inset with a floor on a phone that reports none; an inset a safe area already
 * took is never added twice; a scroll view that lets iOS inset it adds the inset on Android only.
 */

import React, { type ReactNode } from 'react';
import { Platform } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { spacing } from '@/theme';
import { ScreenSafeAreaView } from '@/shared/ui/ScreenSafeAreaView';
import {
  TAB_BAR_SAFE_PADDING,
  isTabBarRoute,
  useBottomClearance,
  useScrollEndInset,
  useTabBarClearance,
} from '@/shared/ui/tabBarClearance';

let mockSegments: string[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => mockSegments,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => ['top', 'bottom', 'left', 'right'],
}));

function withInset(bottom: number, inSafeArea = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const insets = { top: 0, left: 0, right: 0, bottom };
    return (
      <SafeAreaInsetsContext.Provider value={insets}>
        {inSafeArea ? <ScreenSafeAreaView>{children}</ScreenSafeAreaView> : children}
      </SafeAreaInsetsContext.Provider>
    );
  };
}

async function clearance(bottom: number, inSafeArea = false) {
  const hook = await renderHook(() => useBottomClearance(), {
    wrapper: withInset(bottom, inSafeArea),
  });
  return hook.result.current;
}

async function scrollEnd(bottom: number, inSafeArea = false) {
  const hook = await renderHook(() => useScrollEndInset(), {
    wrapper: withInset(bottom, inSafeArea),
  });
  return hook.result.current;
}

const platform = Platform.OS;
afterEach(() => {
  Platform.OS = platform;
});

describe('useBottomClearance', () => {
  it('clears the navigation bar on a stack screen', async () => {
    mockSegments = ['recording', 'review'];
    expect(await clearance(48)).toBe(48);
  });

  it('keeps a floor from the screen edge on a phone that reports no inset', async () => {
    mockSegments = ['recording', 'review'];
    expect(await clearance(0)).toBe(spacing.md);
    expect(await clearance(spacing.md - 4)).toBe(spacing.md);
  });

  it('clears the tab bar and the inset under it on a tab screen', async () => {
    mockSegments = ['(tabs)', 'map'];
    expect(await clearance(48)).toBe(TAB_BAR_SAFE_PADDING + 48);
    expect(await clearance(0)).toBe(TAB_BAR_SAFE_PADDING);
  });

  it('adds nothing a screen safe area already took, only what the floor still owes', async () => {
    mockSegments = ['record'];
    expect(await clearance(34, true)).toBe(0);
    expect(await clearance(0, true)).toBe(spacing.md);
    mockSegments = ['(tabs)', 'map'];
    expect(await clearance(48, true)).toBe(TAB_BAR_SAFE_PADDING);
  });
});

describe('useScrollEndInset', () => {
  it('pads a stack scroll view by the inset on Android, where nothing else insets it', async () => {
    Platform.OS = 'android';
    mockSegments = ['section', 'laps', '[id]'];
    expect(await scrollEnd(48)).toBe(48);
  });

  it('leaves the inset to the system on iOS', async () => {
    Platform.OS = 'ios';
    mockSegments = ['section', 'laps', '[id]'];
    expect(await scrollEnd(34)).toBe(0);
  });

  it('adds the tab bar on a tab screen, and the inset only where a safe area has not', async () => {
    Platform.OS = 'android';
    mockSegments = ['(tabs)', 'training'];
    expect(await scrollEnd(48)).toBe(TAB_BAR_SAFE_PADDING + 48);
    expect(await scrollEnd(48, true)).toBe(TAB_BAR_SAFE_PADDING);
  });
});

describe('isTabBarRoute', () => {
  it('holds for a route in the tabs group', () => {
    expect(isTabBarRoute(['(tabs)'])).toBe(true);
    expect(isTabBarRoute(['(tabs)', 'map'])).toBe(true);
  });

  it('fails for a stack route, including one that names a tab further down', () => {
    expect(isTabBarRoute(['detection-preview'])).toBe(false);
    expect(isTabBarRoute(['recording', '[type]'])).toBe(false);
    expect(isTabBarRoute(['settings', '(tabs)'])).toBe(false);
  });

  it('fails while the route is unresolved', () => {
    expect(isTabBarRoute([])).toBe(false);
  });
});

describe('useTabBarClearance', () => {
  it('clears the bar on a tab screen', async () => {
    mockSegments = ['(tabs)', 'map'];
    expect(await (await renderHook(() => useTabBarClearance())).result.current).toBe(
      TAB_BAR_SAFE_PADDING
    );
    expect(TAB_BAR_SAFE_PADDING).toBeGreaterThan(0);
  });

  it('clears nothing on a stack screen', async () => {
    mockSegments = ['detection-preview'];
    expect(await (await renderHook(() => useTabBarClearance())).result.current).toBe(0);
  });

  it('clears nothing while the route is unresolved', async () => {
    mockSegments = [];
    expect(await (await renderHook(() => useTabBarClearance())).result.current).toBe(0);
  });

  it('follows the route when it changes under the same component', async () => {
    mockSegments = ['(tabs)'];
    const hook = await renderHook(() => useTabBarClearance());
    expect(hook.result.current).toBe(TAB_BAR_SAFE_PADDING);
    mockSegments = ['settings'];
    await hook.rerender({});
    expect(hook.result.current).toBe(0);
  });
});
