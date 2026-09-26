/**
 * Scenario: a push lands, the tray shows only the generic placeholder, and the
 * phone is in hand. The native worker runs in a process with no JavaScript, so
 * nothing it did reached the task-run ring, and a device build logs at `Warn`,
 * so logcat held none of its `info` lines either.
 *
 * Expected behaviour: the Developer Dashboard lists the worker's own runs,
 * with the outcome that ended each one, beside the JavaScript task's log.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';

jest.mock('react-native-safe-area-context', () => {
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

const mockPushRuns = jest.fn(() => [
  {
    ts: 1_758_000_000,
    activityId: 'i12345',
    outcome: 'no-string-bundle',
    detail: undefined,
  },
  {
    ts: 1_757_999_000,
    activityId: 'i12344',
    outcome: 'failed',
    detail: 'the detail of i12344: offline',
  },
]);

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: () => ({ activityCount: 1 }),
        pushRuns: mockPushRuns,
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

async function openBackgroundNotifications() {
  const screen = render(<DebugScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('debug-section-background-notifications'));
  await act(async () => {});
  return screen;
}

describe('the dashboard on the native push worker', () => {
  beforeEach(() => {
    mockPushRuns.mockClear();
  });

  it('names the outcome that ended each run', async () => {
    const screen = await openBackgroundNotifications();

    expect(screen.getByText('no-string-bundle')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('carries the activity and the reason behind a failure', async () => {
    const screen = await openBackgroundNotifications();

    expect(screen.getByText('i12345')).toBeTruthy();
    expect(screen.getByText('i12344 · the detail of i12344: offline')).toBeTruthy();
  });

  it('separates the worker from the JavaScript task, which writes its own log', async () => {
    const screen = await openBackgroundNotifications();

    expect(screen.getByText('Native push worker')).toBeTruthy();
    expect(screen.getByText('JavaScript task')).toBeTruthy();
    expect(screen.getByText('No background task runs recorded yet.')).toBeTruthy();
  });

  it('says so on an install that has had no push, rather than showing nothing', async () => {
    mockPushRuns.mockReturnValueOnce([]);

    const screen = await openBackgroundNotifications();

    expect(screen.getByText('No native push runs recorded yet.')).toBeTruthy();
  });
});
