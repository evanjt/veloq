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

jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  expoConfig: { version: '0.0.0' },
}));

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/insights/lib/taskRunLog', () => ({
  readTaskRuns: jest.fn(async () => []),
  clearTaskRuns: jest.fn(async () => {}),
}));

const mockGetStats = jest.fn(() => ({ activityCount: 1 }));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: mockGetStats,
        pushRuns: () => [],
        engineEventDiagnostics: () => ({
          live: true,
          bindingInitError: null,
          observerError: null,
          received: {},
          delivered: {},
          listeners: {},
        }),
      }),
    },
  })
);

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
