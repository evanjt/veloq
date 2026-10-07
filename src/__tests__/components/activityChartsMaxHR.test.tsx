/**
 * Scenario: the heart rate stat card and the zones chart on one activity each
 * divided by a max HR, and the card once used a literal 200 while the chart
 * resolved its own. The detail screen read resolves it now.
 *
 * Expected behaviour: the charts section hands the one value it was given to
 * both, so the two cannot read different divisors.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityDetail, ActivityStreams } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui', () => {
  const { View } = require('react-native');
  return {
    ComponentErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DeviceAttribution: () => null,
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
const mockHRZonesChart = jest.fn((_props: { maxHR?: number }) => null);
jest.mock('@/features/activity/components/HRZonesChart', () => ({
  HRZonesChart: (props: { maxHR?: number }) => mockHRZonesChart(props),
}));
jest.mock('@/features/activity/components/PowerZonesChart', () => {
  const { View } = require('react-native');
  return { PowerZonesChart: () => <View testID="power-zones-chart" /> };
});
jest.mock('@/features/activity/components/IntervalsTable', () => {
  const { View } = require('react-native');
  return { IntervalsTable: () => <View testID="intervals-table" /> };
});
const mockInsightfulStats = jest.fn((_props: { maxHR?: number }) => null);
jest.mock('@/features/activity/components/stats', () => ({
  InsightfulStats: (props: { maxHR?: number }) => mockInsightfulStats(props),
}));
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
  average_heartrate: 150,
} as unknown as ActivityDetail;

const streams = { time: [0, 1, 2], heartrate: [140, 150, 160] } as unknown as ActivityStreams;

it('gives the zones chart and the stat card the one max HR the screen read resolved', () => {
  render(
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
      maxHR={185}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );

  expect(mockHRZonesChart).toHaveBeenCalled();
  expect(mockInsightfulStats).toHaveBeenCalled();
  expect(mockHRZonesChart.mock.calls.every(([props]) => props.maxHR === 185)).toBe(true);
  expect(mockInsightfulStats.mock.calls.every(([props]) => props.maxHR === 185)).toBe(true);
});
