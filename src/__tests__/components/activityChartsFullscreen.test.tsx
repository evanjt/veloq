/**
 * Scenario: the chart opens full screen, which locks the app to landscape, and
 * the section can unmount while the full-screen view is still open, as when the
 * activity screen is left by a deep link or a back gesture.
 *
 * Expected behaviour: the landscape lock never outlives the section, and the
 * full-screen view lays itself out from its own window's insets, not the ones
 * the screen behind it read in portrait.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityDetail, ActivityStreams } from '@/types';

jest.mock('expo-screen-orientation', () => ({
  ...jest.requireActual('expo-screen-orientation'),
  lockAsync: jest.fn(() => Promise.resolve()),
}));

const MODAL_INSETS = { top: 0, right: 0, bottom: 21, left: 59 };
const MODAL_HEIGHT = 440;

// The screen behind reads no insets of its own here, so anything the
// full-screen view lays out from them has to come from a provider of its own.
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const ReactActual = jest.requireActual('react');
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const portrait = { x: 0, y: 0, width: 440, height: 956 };
  return {
    ...actual,
    useSafeAreaInsets: () => ReactActual.useContext(actual.SafeAreaInsetsContext) ?? zero,
    useSafeAreaFrame: () => ReactActual.useContext(actual.SafeAreaFrameContext) ?? portrait,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.SafeAreaFrameContext.Provider
        value={{ x: 0, y: 0, width: 956, height: MODAL_HEIGHT }}
      >
        <actual.SafeAreaInsetsContext.Provider value={MODAL_INSETS}>
          {children}
        </actual.SafeAreaInsetsContext.Provider>
      </actual.SafeAreaFrameContext.Provider>
    ),
  };
});

jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureHandlerRootView: require('react-native').View,
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: jest.requireActual('@/shared/ui/Card').Card,
    Button: ({ label, testID }: { label: string; testID?: string }) => (
      <Text testID={testID}>{label}</Text>
    ),
    IconButton: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children: React.ReactNode;
      onPress: () => void;
      accessibilityLabel: string;
    }) => (
      <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel}>
        {children}
      </Pressable>
    ),
    pressable: (style: unknown) => style,
    pressRipple: undefined,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => <View />,
  };
});

jest.mock('@/features/activity/components/ChartTypeSelector', () => ({
  ChartTypeSelector: () => null,
}));
jest.mock('@/features/activity/components/ActivityStreams', () => {
  const { View } = require('react-native');
  return {
    ActivityStreams: ({ height }: { height?: number }) => (
      <View testID="activity-streams" accessibilityHint={String(height)} />
    ),
  };
});
jest.mock('@/features/activity/components/HRZonesChart', () => ({ HRZonesChart: () => null }));
jest.mock('@/features/activity/components/PowerZonesChart', () => ({
  PowerZonesChart: () => null,
}));
jest.mock('@/features/activity/components/IntervalsTable', () => ({
  IntervalsTable: () => null,
}));
jest.mock('@/features/activity/components/stats', () => ({ InsightfulStats: () => null }));
jest.mock('@/features/routes', () => ({
  DebugInfoPanel: () => null,
  DebugWarningBanner: () => null,
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));

const lockAsync = ScreenOrientation.lockAsync as jest.Mock;

const activity = {
  id: 'act-1',
  type: 'Ride',
  name: 'Morning ride',
  start_date_local: '2026-09-12T07:00:00',
  moving_time: 3600,
} as unknown as ActivityDetail;

const streams = { time: [0, 1, 2], heartrate: [140, 150, 160] } as unknown as ActivityStreams;

function section() {
  return (
    <ActivityChartsSection
      activity={activity}
      activityId="act-1"
      streams={streams}
      streamsDownloaded
      intervalsData={undefined}
      activityWellness={null}
      coordinates={[]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      transitionSettled={false}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );
}

async function openFullscreen() {
  await act(async () => {
    await fireEvent.press(screen.getByLabelText('maps.openFullscreen'));
  });
  expect(lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.LANDSCAPE);
}

function lastLock() {
  return lockAsync.mock.calls[lockAsync.mock.calls.length - 1]?.[0];
}

beforeEach(() => lockAsync.mockClear());

it('puts the portrait lock back when the section unmounts in full screen', async () => {
  const view = await render(section());
  await openFullscreen();

  await view.unmount();

  expect(lastLock()).toBe(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('puts the portrait lock back on close', async () => {
  await render(section());
  await openFullscreen();

  await act(async () => {
    await fireEvent.press(screen.getByLabelText('common.close'));
  });

  expect(lastLock()).toBe(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('takes no lock on unmount when full screen was never opened', async () => {
  const view = await render(section());
  await view.unmount();
  expect(lockAsync).not.toHaveBeenCalled();
});

it('places the close button from the full-screen window insets', async () => {
  await render(section());
  await openFullscreen();

  const style = StyleSheet.flatten(screen.getByLabelText('common.close').props.style);
  expect(style.left).toBe(MODAL_INSETS.left);
  expect(style.top).toBe(16);
});

it('sizes the plot from the room the measured chrome leaves', async () => {
  await render(section());
  await openFullscreen();

  // Two rows of chips under a larger text size.
  const chromeHeight = 96;
  await act(async () => {
    await fireEvent(screen.getByTestId('fullscreen-chart-controls'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 800, height: chromeHeight } },
    });
  });

  const plots = screen.getAllByTestId('activity-streams');
  const fullscreenPlot = plots[plots.length - 1];
  expect(Number(fullscreenPlot.props.accessibilityHint)).toBe(
    MODAL_HEIGHT - 16 - chromeHeight - MODAL_INSETS.bottom
  );
});
