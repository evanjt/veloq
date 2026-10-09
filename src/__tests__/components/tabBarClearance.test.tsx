/**
 * Scenario: the tab bar draws only inside the tabs group, and every screen that pads for it reads
 * the clearance from the same place the bar reads its own visibility.
 *
 * Expected behaviour: a route in the tabs group clears the bar, any other route and an unresolved
 * route clear nothing.
 */

import { renderHook } from '@testing-library/react-native';

import {
  TAB_BAR_SAFE_PADDING,
  isTabBarRoute,
  useTabBarClearance,
} from '@/shared/ui/tabBarClearance';

let mockSegments: string[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => mockSegments,
}));

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
  it('clears the bar on a tab screen', () => {
    mockSegments = ['(tabs)', 'map'];
    expect(renderHook(() => useTabBarClearance()).result.current).toBe(TAB_BAR_SAFE_PADDING);
    expect(TAB_BAR_SAFE_PADDING).toBeGreaterThan(0);
  });

  it('clears nothing on a stack screen', () => {
    mockSegments = ['detection-preview'];
    expect(renderHook(() => useTabBarClearance()).result.current).toBe(0);
  });

  it('clears nothing while the route is unresolved', () => {
    mockSegments = [];
    expect(renderHook(() => useTabBarClearance()).result.current).toBe(0);
  });

  it('follows the route when it changes under the same component', () => {
    mockSegments = ['(tabs)'];
    const hook = renderHook(() => useTabBarClearance());
    expect(hook.result.current).toBe(TAB_BAR_SAFE_PADDING);
    mockSegments = ['settings'];
    hook.rerender({});
    expect(hook.result.current).toBe(0);
  });
});
