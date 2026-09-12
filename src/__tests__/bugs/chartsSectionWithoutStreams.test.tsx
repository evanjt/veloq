/**
 * Scenario: an activity opened offline whose streams were never fetched. Its
 * intervals and its power zone times are both in SQLite and neither needs a
 * stream, but they sat inside a block gated on `availableCharts.length > 0`.
 *
 * Expected behaviour: each block is gated on the data it actually reads, so a
 * streamless activity still shows its interval table and its power zones.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityChartsSection } from '@/features/activity/components/ActivityChartsSection';
import type { ActivityDetail, ActivityInterval, ActivityStreams } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
jest.mock('@/features/activity/components/HRZonesChart', () => {
  const { View } = require('react-native');
  return { HRZonesChart: () => <View testID="hr-zones-chart" /> };
});
jest.mock('@/features/activity/components/PowerZonesChart', () => {
  const { View } = require('react-native');
  return { PowerZonesChart: () => <View testID="power-zones-chart" /> };
});
jest.mock('@/features/activity/components/IntervalsTable', () => {
  const { View } = require('react-native');
  return { IntervalsTable: () => <View testID="intervals-table" /> };
});
jest.mock('@/features/activity/components/stats', () => ({ InsightfulStats: () => null }));
jest.mock('@/features/routes', () => ({
  DebugInfoPanel: () => null,
  DebugWarningBanner: () => null,
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));

const intervals: ActivityInterval[] = [
  { type: 'WORK', zone: 3, moving_time: 300, start_index: 0, end_index: 100 },
] as unknown as ActivityInterval[];

function activityWith(extra: Partial<ActivityDetail> = {}): ActivityDetail {
  return {
    id: 'act-1',
    type: 'Ride',
    name: 'Morning ride',
    start_date_local: '2026-09-12T07:00:00',
    ...extra,
  } as unknown as ActivityDetail;
}

function renderSection(props: {
  streams?: ActivityStreams;
  activity?: ActivityDetail;
  intervalsData?: { icu_intervals: ActivityInterval[] };
}) {
  return render(
    <ActivityChartsSection
      activity={props.activity ?? activityWith()}
      activityId="act-1"
      streams={props.streams}
      intervalsData={props.intervalsData}
      activityWellness={null}
      coordinates={[]}
      isDark={false}
      isMetric
      debugEnabled={false}
      gpxExporting={false}
      chartInteracting={false}
      engineSectionCount={0}
      customSectionCount={0}
      onPointSelect={() => {}}
      onInteractionChange={() => {}}
      onExportGpx={() => {}}
    />
  );
}

it('shows the interval table for an activity with no streams', () => {
  const { getByTestId, queryByTestId } = renderSection({
    streams: undefined,
    intervalsData: { icu_intervals: intervals },
  });

  expect(getByTestId('activity-interval-table')).toBeTruthy();
  expect(queryByTestId('combined-plot')).toBeNull();
});

it('shows the power zone chart for an activity with no streams', () => {
  const { getByTestId } = renderSection({
    streams: undefined,
    activity: activityWith({
      icu_zone_times: [
        { id: 'Z1', secs: 10 },
        { id: 'Z2', secs: 20 },
      ],
    }),
  });

  expect(getByTestId('power-zones-chart')).toBeTruthy();
});

it('shows neither when the activity carries neither', () => {
  const { queryByTestId } = renderSection({ streams: undefined });

  expect(queryByTestId('activity-interval-table')).toBeNull();
  expect(queryByTestId('power-zones-chart')).toBeNull();
});

it('still shows the chart and the HR zones when the streams are there', () => {
  const { getByTestId } = renderSection({
    streams: { heartrate: [120, 130], time: [0, 1] } as unknown as ActivityStreams,
    intervalsData: { icu_intervals: intervals },
    activity: activityWith({
      icu_zone_times: [
        { id: 'Z1', secs: 10 },
        { id: 'Z2', secs: 20 },
      ],
    }),
  });

  expect(getByTestId('combined-plot')).toBeTruthy();
  expect(getByTestId('hr-zones-chart')).toBeTruthy();
  expect(getByTestId('activity-interval-table')).toBeTruthy();
  expect(getByTestId('power-zones-chart')).toBeTruthy();
});
