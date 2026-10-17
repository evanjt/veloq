/**
 * Scenario: the activity chart plots against distance or time. The switch was a
 * button over the plot labelled with the total distance, so a screen reader
 * heard "42.3 km, button" and nothing about the axis.
 *
 * Expected behaviour: the chart header holds a two-option control named
 * Distance and Time, with the plotted axis selected, and choosing an option
 * re-plots against it. An activity with only one axis gets no control.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityDetail, ActivityStreams } from '@/types';

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
jest.mock('@/features/activity/components/CombinedPlot', () => {
  const { View } = require('react-native');
  return {
    CombinedPlot: ({ xAxisMode }: { xAxisMode: string }) => (
      <View testID="combined-plot" accessibilityHint={xAxisMode} />
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

const activity = {
  id: 'act-1',
  type: 'Ride',
  name: 'Harbour loop',
  start_date_local: '2026-09-12T07:00:00',
  moving_time: 3600,
} as unknown as ActivityDetail;

const bothAxes = {
  time: [0, 1, 2],
  distance: [0, 8, 16],
  heartrate: [140, 150, 160],
} as unknown as ActivityStreams;

const timeOnly = { time: [0, 1, 2], heartrate: [140, 150, 160] } as unknown as ActivityStreams;

function section(streams: ActivityStreams) {
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

function option(name: 'distance' | 'time') {
  return screen.getByRole('button', { name: `activity.xAxis.${name}` });
}

function plottedAxis() {
  return screen.getByTestId('combined-plot').props.accessibilityHint;
}

it('offers Distance and Time with the plotted axis selected', async () => {
  await render(section(bothAxes));

  expect(option('distance').props.accessibilityState).toMatchObject({ selected: true });
  expect(option('time').props.accessibilityState).toMatchObject({ selected: false });
  expect(plottedAxis()).toBe('distance');
});

it('re-plots against time when Time is chosen, and back again', async () => {
  await render(section(bothAxes));

  await act(async () => {
    await fireEvent.press(option('time'));
  });
  expect(option('time').props.accessibilityState).toMatchObject({ selected: true });
  expect(option('distance').props.accessibilityState).toMatchObject({ selected: false });
  expect(plottedAxis()).toBe('time');

  await act(async () => {
    await fireEvent.press(option('distance'));
  });
  expect(option('distance').props.accessibilityState).toMatchObject({ selected: true });
  expect(plottedAxis()).toBe('distance');
});

it('keeps the axis when the selected option is pressed again', async () => {
  await render(section(bothAxes));

  await act(async () => {
    await fireEvent.press(option('distance'));
  });

  expect(option('distance').props.accessibilityState).toMatchObject({ selected: true });
  expect(plottedAxis()).toBe('distance');
});

it('offers no axis choice when the activity has only a time stream', async () => {
  await render(section(timeOnly));

  expect(screen.queryByRole('button', { name: 'activity.xAxis.distance' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'activity.xAxis.time' })).toBeNull();
  expect(plottedAxis()).toBe('time');
});
