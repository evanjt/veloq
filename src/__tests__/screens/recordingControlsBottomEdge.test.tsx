/**
 * Scenario: a live recording on a phone that reports no bottom inset, such as a home-button iPhone
 * or Android with its navigation bar hidden, and on one with a gesture bar.
 *
 * Expected behaviour: Pause, Stop and Lap, and the unlock track while locked, keep a margin from
 * the screen edge with no inset, and clear the inset exactly once when there is one.
 *
 * Scenario: the same screen in a split-screen pane or at a large text size, where the column is
 * taller than the window.
 *
 * Expected behaviour: the controls and the unlock track sit outside the region that gives way, so
 * the map shrinks and then the region scrolls while they stay on screen.
 */

import React, { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import RecordingScreen from '@/app/recording/[type]';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { spacing } from '@/theme';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import type { ReactTestInstance } from 'react-test-renderer';

let mockParams: Record<string, string | undefined> = {};
const mockBodies: string[] = [];

jest.mock('@/features/recording/hooks/useRecordingScreenColors', () => {
  const actual = jest.requireActual('@/features/recording/hooks/useRecordingScreenColors');
  return {
    ...actual,
    useRecordingScreenColors: () => {
      return actual.useRecordingScreenColors();
    },
  };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getCalendarEventBodies: () => mockBodies, subscribe: () => () => {} }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
// A render error surfaces as itself rather than as the boundary's fallback.
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: <P extends object>(Screen: React.ComponentType<P>) => Screen,
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  moveAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => {
    const { View } = require('react-native');
    return <View testID="recording-map" />;
  },
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/UnlockTrack', () => ({
  UnlockTrack: ({ onUnlock }: { onUnlock: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="unlock" onPress={onUnlock} />;
  },
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({
  DataFieldGrid: () => null,
}));

function withInset(bottom: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom }}>
        {children}
      </SafeAreaInsetsContext.Provider>
    );
  };
}

/** The bottom padding of the view holding the given control, walking up to the first that has one. */
function bottomPaddingAround(testID: string): number {
  let node = screen.getByTestId(testID).parent;
  while (node) {
    const padding = StyleSheet.flatten(node.props.style)?.paddingBottom;
    if (typeof padding === 'number') return padding;
    node = node.parent;
  }
  throw new Error(`nothing around ${testID} pads its bottom`);
}

beforeEach(() => {
  jest.useFakeTimers();
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  mockParams = { type: 'Ride' };
});

afterEach(() => {
  useRecordingStore.getState().reset();
  jest.useRealTimers();
});

async function unlock() {
  await act(async () => fireEvent.press(screen.getByTestId('unlock')));
}

it('keeps the controls a margin from the edge on a phone with no bottom inset', async () => {
  await render(<RecordingScreen />, { wrapper: withInset(0) });
  await unlock();

  expect(bottomPaddingAround('control-pause')).toBeGreaterThanOrEqual(spacing.md);
});

it('keeps the unlock track a margin from the edge on a phone with no bottom inset', async () => {
  await render(<RecordingScreen />, { wrapper: withInset(0) });

  expect(
    StyleSheet.flatten(screen.getByTestId('recording-unlock-slot').props.style).paddingBottom
  ).toBeGreaterThanOrEqual(spacing.md);
});

it('clears a gesture bar once', async () => {
  await render(<RecordingScreen />, { wrapper: withInset(48) });
  expect(
    StyleSheet.flatten(screen.getByTestId('recording-unlock-slot').props.style).paddingBottom
  ).toBe(48);
  await unlock();

  expect(bottomPaddingAround('control-pause')).toBe(48);
});

function isInside(node: ReactTestInstance, ancestor: ReactTestInstance): boolean {
  for (let at: ReactTestInstance | null = node.parent; at; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
}

async function layOut(testID: string, height: number) {
  await act(async () =>
    fireEvent(screen.getByTestId(testID), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    })
  );
}

describe('in a window shorter than the column', () => {
  it('keeps the unlock track out of the region that gives way', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });

    const region = screen.getByTestId('recording-column-region');
    expect(isInside(screen.getByTestId('recording-unlock-slot'), region)).toBe(false);
    expect(isInside(screen.getByTestId('recording-timer'), region)).toBe(true);
  });

  it('keeps Stop, Lap and Pause out of the region that gives way', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });
    await unlock();

    const region = screen.getByTestId('recording-column-region');
    for (const control of ['control-stop', 'control-lap', 'control-pause']) {
      expect(isInside(screen.getByTestId(control), region)).toBe(false);
    }
  });

  it('gives the map what is left of a half-screen pane, without scrolling', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });
    await unlock();
    await layOut('recording-column-head', 125);
    await layOut('recording-column-tiles', 167);
    await layOut('recording-column-region', 310);

    const region = screen.getByTestId('recording-column-region');
    expect(region.props.scrollEnabled).toBe(false);
    expect(StyleSheet.flatten(screen.getByTestId('recording-map-slot').props.style).height).toBe(
      18
    );
  });

  it('scrolls the region with the map at zero, still mounted, once the tiles alone overflow it', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });
    await unlock();
    await layOut('recording-column-head', 125);
    await layOut('recording-column-tiles', 167);
    await layOut('recording-column-region', 180);

    expect(screen.getByTestId('recording-column-region').props.scrollEnabled).toBe(true);
    expect(StyleSheet.flatten(screen.getByTestId('recording-map-slot').props.style).height).toBe(0);
    expect(screen.getByTestId('recording-map')).toBeTruthy();
  });

  it('holds the region still while locked, as the lock holds the map', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });
    await layOut('recording-column-head', 125);
    await layOut('recording-column-tiles', 167);
    await layOut('recording-column-region', 180);

    expect(screen.getByTestId('recording-column-region').props.scrollEnabled).toBe(false);
  });

  it('caps the timer at the dense text scale', async () => {
    await render(<RecordingScreen />, { wrapper: withInset(0) });

    expect(screen.getByTestId('recording-timer').props.maxFontSizeMultiplier).toBe(
      DENSE_TEXT_SCALE
    );
  });
});
