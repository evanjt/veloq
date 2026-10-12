/**
 * Scenario: an activity opens on the Charts tab. Its first commit once carried
 * the whole tab, the stat cards and the device line far below the fold
 * included, into the frame of the opening tap.
 *
 * Expected behaviour: the chart at the top mounts with the screen. What sits
 * below it waits for the opening transition to settle, and then for a frame
 * after the tab's own first commit, so the two never share a frame.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityDetail, ActivityStreams } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View, Text } = require('react-native');
  return {
    Button: ({ label, testID }: { label: string; testID?: string }) => (
      <Text testID={testID}>{label}</Text>
    ),
    IconButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    pressable: (style: unknown) => style,
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => <View testID="device-attribution" />,
    ScreenSafeAreaView: View,
  };
});

jest.mock('@/features/activity/components/ChartTypeSelector', () => ({
  ChartTypeSelector: () => null,
}));
jest.mock('@/features/activity/components/CombinedPlot', () => {
  const { View } = require('react-native');
  return { CombinedPlot: () => <View testID="combined-plot" /> };
});
jest.mock('@/features/activity/components/HRZonesChart', () => {
  const { View } = require('react-native');
  return { HRZonesChart: () => <View testID="hr-zones-chart" /> };
});
jest.mock('@/features/activity/components/PowerZonesChart', () => ({
  PowerZonesChart: () => null,
}));
jest.mock('@/features/activity/components/IntervalsTable', () => ({
  IntervalsTable: () => null,
}));
jest.mock('@/features/activity/components/stats', () => {
  const { View } = require('react-native');
  return { InsightfulStats: () => <View testID="insightful-stats" /> };
});
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
  name: 'Morning ride',
  start_date_local: '2026-09-12T07:00:00',
  moving_time: 3600,
  device_name: 'Head unit',
} as unknown as ActivityDetail;

const streams = { time: [0, 1, 2], heartrate: [140, 150, 160] } as unknown as ActivityStreams;
const hrZones = [{ zone: 1, minBpm: 0, maxBpm: 140, seconds: 60, percent: 100 }];

const frames: FrameRequestCallback[] = [];

async function flushFrame() {
  const pending = frames.splice(0);
  await act(() => pending.forEach((callback) => callback(0)));
}

function section(transitionSettled: boolean) {
  return (
    <ActivityChartsSection
      activity={activity}
      activityId="act-1"
      streams={streams}
      streamsDownloaded
      intervalsData={undefined}
      activityWellness={null}
      coordinates={[{ latitude: 1, longitude: 2 }]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      hrZones={hrZones}
      transitionSettled={transitionSettled}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );
}

function expectBelowFold(present: boolean) {
  for (const id of ['insightful-stats', 'activity-export-gpx', 'device-attribution']) {
    if (present) expect(screen.getByTestId(id)).toBeTruthy();
    else expect(screen.queryByTestId(id)).toBeNull();
  }
}

beforeEach(() => {
  frames.length = 0;
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('mounts the top chart with the screen and holds the rest while the transition runs', async () => {
  await render(section(false));

  expect(screen.getByTestId('combined-plot')).toBeTruthy();
  expect(screen.getByTestId('hr-zones-chart')).toBeTruthy();
  expectBelowFold(false);

  await flushFrame();
  await flushFrame();
  expectBelowFold(false);
});

it('mounts the rest a frame after the transition settles', async () => {
  const view = await render(section(false));

  await view.rerender(section(true));
  expectBelowFold(false);

  await flushFrame();
  expectBelowFold(true);
  expect(screen.getByTestId('combined-plot')).toBeTruthy();
});

it('keeps the rest out of the first commit when the transition settled before the tab mounted', async () => {
  await render(section(true));

  expect(screen.getByTestId('combined-plot')).toBeTruthy();
  expectBelowFold(false);

  await flushFrame();
  expectBelowFold(true);
});

it('keeps the rest mounted once shown', async () => {
  const view = await render(section(true));
  await flushFrame();

  await view.rerender(section(false));
  expectBelowFold(true);
});
