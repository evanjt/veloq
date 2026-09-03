/**
 * Scenario: the debug screen reads engine stats to show them, and re-reads on
 * pull to refresh. The read was in the render body, so every re-render made
 * the call and the refresh key at the bottom of the screen keyed nothing.
 *
 * Expected behaviour: one read per mount, one more per refresh.
 */

import React from 'react';
import { RefreshControl } from 'react-native';
import { act, render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('expo-router', () => {
  function Stack() {
    return null;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return { Stack, router: { back: jest.fn() } };
});

jest.mock('expo-constants', () => ({ expoConfig: { version: '0.0.0' } }));

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/insights/lib/taskRunLog', () => ({
  readTaskRuns: jest.fn(async () => []),
  clearTaskRuns: jest.fn(async () => {}),
}));

const mockGetStats = jest.fn(() => ({ activityCount: 1 }));
jest.mock('veloqrs', () => ({
  EngineClient: { getInstance: () => ({ getStats: mockGetStats }) },
}));

describe('debug screen engine stats', () => {
  it('reads stats once per mount and once more per refresh', async () => {
    const screen = render(<DebugScreen />);
    await act(async () => {});

    expect(mockGetStats).toHaveBeenCalledTimes(1);

    screen.rerender(<DebugScreen />);
    await act(async () => {});
    expect(mockGetStats).toHaveBeenCalledTimes(1);

    const refresh = screen.UNSAFE_getByType(RefreshControl);
    await act(async () => {
      refresh.props.onRefresh();
    });
    expect(mockGetStats).toHaveBeenCalledTimes(2);
  });
});
